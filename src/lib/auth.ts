import { eq } from 'drizzle-orm'
import { createMiddleware } from 'hono/factory'
import { sign, verify } from 'hono/jwt'
import { db } from '../db'
import { users } from '../db/schema'
import { env } from '../env'
import type { ModuleKey } from '../shared/types'
import { forbidden, unauthorized } from './errors'

export type UserRow = typeof users.$inferSelect
export type AppEnv = { Variables: { user: UserRow } }

export const ACCESS_TTL_SEC = 15 * 60

export const signAccess = (userId: string) =>
  sign({ sub: userId, exp: Math.floor(Date.now() / 1000) + ACCESS_TTL_SEC }, env.JWT_SECRET, 'HS256')

// Loads the user on every request (one indexed query), so access changes and deactivation apply immediately.
export const authenticate = createMiddleware<AppEnv>(async (c, next) => {
  const token = c.req.header('authorization')?.replace(/^Bearer /, '')
  if (!token) throw unauthorized()
  const payload = await verify(token, env.JWT_SECRET, 'HS256').catch(() => { throw unauthorized() })
  const [user] = await db.select().from(users).where(eq(users.id, String(payload.sub)))
  if (!user?.active) throw unauthorized()
  c.set('user', user)
  await next()
})

// Passes if the user has ANY of the given modules (mirrors the frontend's per-module access).
export const requireModule = (...keys: ModuleKey[]) =>
  createMiddleware<AppEnv>(async (c, next) => {
    if (!keys.some((k) => c.var.user.modules.includes(k))) throw forbidden()
    await next()
  })

export const requireOwner = createMiddleware<AppEnv>(async (c, next) => {
  if (c.var.user.role !== 'Owner') throw forbidden('Only the owner can do this')
  await next()
})

// Never send the PIN hash or lockout internals to clients.
export const publicUser = ({ pinHash: _p, failedLogins: _f, lockedUntil: _l, createdAt: _c, ...u }: UserRow) => u
