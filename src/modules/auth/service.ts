import { hash, verify as verifyHash } from '@node-rs/argon2'
import { createHash, randomBytes } from 'node:crypto'
import { and, eq, gt, sql } from 'drizzle-orm'
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

export async function login(phone: string, pin: string) {
  const [u] = await db.select().from(users).where(eq(users.phone, phone))
  const wrong = new AppError('invalid_login', 'Wrong phone number or PIN', 401) // same message for unknown phone: no account probing
  if (!u?.active) throw wrong
  if (u.lockedUntil && u.lockedUntil > new Date()) {
    const mins = Math.ceil((u.lockedUntil.getTime() - Date.now()) / 60000)
    throw new AppError('locked', `Too many wrong PINs. Try again in ${mins} min.`, 423)
  }
  if (!(await verifyHash(u.pinHash, pin))) {
    const failed = u.failedLogins + 1
    const lock = failed >= MAX_FAILED
    await db.update(users).set({ failedLogins: lock ? 0 : failed, lockedUntil: lock ? new Date(Date.now() + LOCK_MIN * 60000) : null }).where(eq(users.id, u.id))
    throw wrong
  }
  if (u.failedLogins || u.lockedUntil) await db.update(users).set({ failedLogins: 0, lockedUntil: null }).where(eq(users.id, u.id))
  return { user: u, ...(await issueTokens(u.id)) }
}

// Rotates the refresh token. Re-use of a revoked token means it leaked: revoke every session of that user.
export async function refresh(raw: string | undefined) {
  if (!raw) throw unauthorized()
  const [t] = await db.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, sha256(raw)))
  if (!t || t.expiresAt < new Date()) throw unauthorized()
  if (t.revoked) {
    await revokeAll(t.userId)
    throw unauthorized()
  }
  const [u] = await db.select().from(users).where(eq(users.id, t.userId))
  if (!u?.active) throw unauthorized()
  await db.update(refreshTokens).set({ revoked: true }).where(eq(refreshTokens.tokenHash, t.tokenHash))
  return { user: u, ...(await issueTokens(u.id)) }
}

export async function logout(raw: string | undefined) {
  if (raw) await db.update(refreshTokens).set({ revoked: true }).where(eq(refreshTokens.tokenHash, sha256(raw)))
}

export const revokeAll = (userId: string, ex: DB = db) =>
  ex.update(refreshTokens).set({ revoked: true }).where(and(eq(refreshTokens.userId, userId), eq(refreshTokens.revoked, false), gt(refreshTokens.expiresAt, sql`now()`)))
