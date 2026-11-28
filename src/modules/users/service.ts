import { asc, eq } from 'drizzle-orm'
import type { z } from 'zod'
import { db } from '../../db'
import { users } from '../../db/schema'
import { audit } from '../../lib/audit'
import { publicUser, type UserRow } from '../../lib/auth'
import { AppError, conflict, notFound } from '../../lib/errors'
import type { userCreate, userPatch } from '../../shared/schemas'
import { hashPin, revokeAll } from '../auth/service'

const newId = () => `u${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`

export const listUsers = async () => (await db.select().from(users).orderBy(asc(users.createdAt), asc(users.id))).map(publicUser)

async function phoneFree(phone: string, exceptId?: string) {
  const [dup] = await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.phone, phone))
  if (dup && dup.id !== exceptId) throw conflict(`${phone} already belongs to ${dup.name}`)
}

export async function createUser(by: UserRow, input: z.infer<typeof userCreate>) {
  await phoneFree(input.phone)
  const { pin, ...rest } = input
  const row = { ...rest, id: newId(), pinHash: await hashPin(pin), hue: rest.hue ?? Math.floor(Math.random() * 360) }
  return db.transaction(async (tx) => {
    const [u] = await tx.insert(users).values(row).returning()
    await audit(tx, { userId: by.id, action: 'User added', detail: `${u!.name} · ${u!.role}`, entity: 'user', entityId: u!.id })
    return publicUser(u!)
  })
}

export async function updateUser(by: UserRow, id: string, patch: z.infer<typeof userPatch>) {
  // The owner must not lock themselves out of user management.
  if (id === by.id && (patch.active === false || (patch.modules && !patch.modules.includes('users')) || (patch.role && patch.role !== 'Owner'))) {
    throw new AppError('self_lockout', 'You cannot remove your own access')
  }
  if (patch.phone) await phoneFree(patch.phone, id)
  return db.transaction(async (tx) => {
    const [u] = await tx.update(users).set(patch).where(eq(users.id, id)).returning()
    if (!u) throw notFound('User')
    const what = patch.modules ? 'Access changed' : patch.active === false ? 'User deactivated' : 'User updated'
    await audit(tx, { userId: by.id, action: what, detail: u.name, entity: 'user', entityId: id })
    if (patch.active === false) await revokeAll(id, tx)
    return publicUser(u)
  })
}

export async function resetPin(by: UserRow, id: string, pin: string) {
  const pinHash = await hashPin(pin)
  await db.transaction(async (tx) => {
    const [u] = await tx.update(users).set({ pinHash, failedLogins: 0, lockedUntil: null }).where(eq(users.id, id)).returning({ name: users.name })
    if (!u) throw notFound('User')
    await audit(tx, { userId: by.id, action: 'PIN reset', detail: u.name, entity: 'user', entityId: id })
  })
  await revokeAll(id) // old sessions end when the PIN changes
}
