import { hash, verify as verifyHash } from '@node-rs/argon2'
import { createHash, randomBytes } from 'node:crypto'
import { and, eq, gt, isNull, lte, or, sql } from 'drizzle-orm'
import { db, type DB } from '../../db'
import { refreshTokens, users } from '../../db/schema'
import { signAccess } from '../../lib/auth'
import { AppError, unauthorized } from '../../lib/errors'

export const MAX_FAILED = 5
export const LOCK_MIN = 15
export const REFRESH_DAYS = 30

export const hashPin = (pin: string) => hash(pin)
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

async function issueTokens(userId: string) {
  const refresh = randomBytes(32).toString('hex')
  await db.insert(refreshTokens).values({ tokenHash: sha256(refresh), userId, expiresAt: new Date(Date.now() + REFRESH_DAYS * 86400000) })
  return { accessToken: await signAccess(userId), refresh }
}

const lock = (id: string) => db.update(users).set({ failedLogins: 0, lockedUntil: new Date(Date.now() + LOCK_MIN * 60000) }).where(eq(users.id, id))

// Unknown phones and locked accounts still run one argon2 check (against this), so every refusal takes as long
// as a real wrong PIN and gives the same answer: response time and wording don't tell which numbers are staff.
const DUMMY_HASH = hash('not-a-pin')
const refusal = () => new AppError('invalid_login', `Wrong phone number or PIN. After ${MAX_FAILED} wrong tries the account locks for ${LOCK_MIN} minutes.`, 401)
const refuse = async (pin: string) => { await verifyHash(await DUMMY_HASH, pin); return refusal() } // no real PIN was checked

// Each attempt is counted in one statement BEFORE the PIN is checked, so guesses sent in parallel each get their
// own number: at most MAX_FAILED PINs are ever checked per lock window (reading the count first let 30 parallel
// guesses all see 0 and never lock).
export async function login(phone: string, pin: string) {
  const [u] = await db.select().from(users).where(eq(users.phone, phone))
  if (!u?.active) throw await refuse(pin)
  const [attempt] = await db.update(users).set({ failedLogins: sql`${users.failedLogins} + 1` })
    .where(and(eq(users.id, u.id), or(isNull(users.lockedUntil), lte(users.lockedUntil, new Date()))))
    .returning({ n: users.failedLogins })
  if (!attempt) throw await refuse(pin) // locked
  if (attempt.n > MAX_FAILED) { await lock(u.id); throw await refuse(pin) } // more guesses in flight than allowed
  if (!(await verifyHash(u.pinHash, pin))) {
    if (attempt.n >= MAX_FAILED) await lock(u.id)
    throw refusal()
  }
  await db.update(users).set({ failedLogins: 0, lockedUntil: null }).where(eq(users.id, u.id))
  return { user: u, ...(await issueTokens(u.id)) }
}

// Two tabs (or a reload during a refresh) can send the same cookie a moment apart: that's not theft.
export const REUSE_GRACE_MS = 30_000

// Rotates the refresh token. Taking it is one statement (only an unrevoked, unexpired token is taken), so two
// parallel calls can't both get a session from it. A token reused well after it was rotated means it leaked:
// revoke every session of that user.
export async function refresh(raw: string | undefined) {
  if (!raw) throw unauthorized()
  const tokenHash = sha256(raw)
  const [taken] = await db.update(refreshTokens).set({ revoked: true, revokedAt: new Date() })
    .where(and(eq(refreshTokens.tokenHash, tokenHash), eq(refreshTokens.revoked, false), gt(refreshTokens.expiresAt, new Date())))
    .returning({ userId: refreshTokens.userId })
  if (!taken) {
    const [t] = await db.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, tokenHash))
    const reused = t?.revoked && Date.now() - (t.revokedAt?.getTime() ?? 0) > REUSE_GRACE_MS
    if (reused) await revokeAll(t.userId)
    throw unauthorized()
  }
  const [u] = await db.select().from(users).where(eq(users.id, taken.userId))
  if (!u?.active) throw unauthorized()
  return { user: u, ...(await issueTokens(u.id)) }
}

export async function logout(raw: string | undefined) {
  if (raw) await db.update(refreshTokens).set({ revoked: true, revokedAt: new Date() }).where(eq(refreshTokens.tokenHash, sha256(raw)))
}

export const revokeAll = (userId: string, ex: DB = db) =>
  ex.update(refreshTokens).set({ revoked: true, revokedAt: new Date() })
    .where(and(eq(refreshTokens.userId, userId), eq(refreshTokens.revoked, false), gt(refreshTokens.expiresAt, sql`now()`)))
