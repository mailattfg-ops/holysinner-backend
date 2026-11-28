import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { db } from '../src/db'
import { auditLog, refreshTokens, users } from '../src/db/schema'
import { REUSE_GRACE_MS } from '../src/modules/auth/service'
import { seed } from '../src/db/seed'
import { call, cookieOf, json, login, MANAGER, OWNER } from './helpers'

beforeAll(() => seed())

describe('auth', () => {
  it('logs in with phone + PIN and never returns the PIN hash', async () => {
    const res = await call('/auth/login', { body: { phone: OWNER, pin: '1234' } })
    expect(res.status).toBe(200)
    const body = await json<{ accessToken: string; user: Record<string, unknown> }>(res)
    expect(body.accessToken).toBeTruthy()
    expect(body.user).toMatchObject({ id: 'u1', role: 'Owner' })
    expect(body.user).not.toHaveProperty('pinHash')
    expect(res.headers.get('set-cookie')).toMatch(/hs_refresh=.+HttpOnly/i)
  })

  it('wrong PIN and unknown phone give the same answer', async () => {
    const a = await call('/auth/login', { body: { phone: OWNER, pin: '0000' } })
    const b = await call('/auth/login', { body: { phone: '9000000000', pin: '0000' } })
    expect([a.status, b.status]).toEqual([401, 401])
    expect(await json(a)).toEqual(await json(b))
  })

  const lockedUntil = async (phone: string) => (await db.select({ until: users.lockedUntil }).from(users).where(eq(users.phone, phone)))[0]?.until

  it('locks after 5 wrong PINs, answering exactly like an unknown phone; an owner PIN reset unlocks', async () => {
    const cashier = '9847033333'
    for (let i = 0; i < 5; i++) await call('/auth/login', { body: { phone: cashier, pin: '9999' } })
    const locked = await call('/auth/login', { body: { phone: cashier, pin: '1234' } }) // the right PIN, but locked
    const unknown = await call('/auth/login', { body: { phone: '9000000001', pin: '1234' } })
    expect([locked.status, unknown.status]).toEqual([401, 401])
    expect(await json(locked)).toEqual(await json(unknown)) // a lock doesn't reveal that the number is a staff account
    expect(await lockedUntil(cashier)).toBeTruthy()

    const { token } = await login(OWNER)
    expect((await call('/users/u3/pin', { method: 'PUT', body: { pin: '4321' }, token })).status).toBe(200)
    expect((await login(cashier, '4321')).token).toBeTruthy()
  })

  it('30 wrong PINs sent at once still lock the account (no shared count to race on)', async () => {
    const cashier = '9847044444' // u4
    const tries = await Promise.all(Array.from({ length: 30 }, () => call('/auth/login', { body: { phone: cashier, pin: '9999' } })))
    expect(tries.every((r) => r.status === 401)).toBe(true)
    expect(await lockedUntil(cashier)).toBeTruthy()
    expect((await call('/auth/login', { body: { phone: cashier, pin: '1234' } })).status).toBe(401) // the right PIN is refused too
  })

  it('/me needs a valid token', async () => {
    const { token } = await login(OWNER)
    expect((await call('/auth/me', { token })).status).toBe(200)
    expect((await call('/auth/me')).status).toBe(401)
    expect((await call('/auth/me', { token: 'garbage' })).status).toBe(401)
  })

  it('refresh rotates the cookie; a just-rotated one (another tab) is refused quietly, an old reused one revokes everything', async () => {
    const { cookie } = await login(OWNER)
    const r1 = await call('/auth/refresh', { method: 'POST', cookie })
    expect(r1.status).toBe(200)
    const fresh = cookieOf(r1)
    expect(fresh).not.toBe(cookie)

    // another tab sends the old cookie a moment later: refused, but the new session lives on
    expect((await call('/auth/refresh', { method: 'POST', cookie })).status).toBe(401)
    const r2 = await call('/auth/refresh', { method: 'POST', cookie: fresh })
    expect(r2.status).toBe(200)
    const latest = cookieOf(r2)

    // the same old cookie turning up long after it was rotated means it leaked
    await db.update(refreshTokens).set({ revokedAt: new Date(Date.now() - REUSE_GRACE_MS - 1000) }).where(eq(refreshTokens.revoked, true))
    expect((await call('/auth/refresh', { method: 'POST', cookie })).status).toBe(401) // replayed → theft assumed
    expect((await call('/auth/refresh', { method: 'POST', cookie: latest })).status).toBe(401) // …so the live one died too
  })

  it('two refreshes with the same cookie at once give one session, not two', async () => {
    const { cookie } = await login(OWNER)
    const both = await Promise.all([1, 2].map(() => call('/auth/refresh', { method: 'POST', cookie })))
    expect(both.map((r) => r.status).sort()).toEqual([200, 401])
  })

  it('logout revokes the refresh cookie', async () => {
    const { cookie } = await login(OWNER)
    expect((await call('/auth/logout', { method: 'POST', cookie })).status).toBe(200)
    expect((await call('/auth/refresh', { method: 'POST', cookie })).status).toBe(401)
  })
})

describe('users & access', () => {
  it('needs the users module to list; hides PIN hashes', async () => {
    const manager = await login(MANAGER)
    expect((await call('/users', { token: manager.token })).status).toBe(403)

    const { token } = await login(OWNER)
    const list = await json<Record<string, unknown>[]>(await call('/users', { token }))
    expect(list.length).toBeGreaterThanOrEqual(7)
    expect(list.every((u) => !('pinHash' in u))).toBe(true)
  })

  it('owner creates a user who can then log in; validation and duplicates are rejected', async () => {
    const { token } = await login(OWNER)
    const body = { name: 'Anjali Varghese', phone: '9847099999', pin: '5555', role: 'Cashier', salary: 18000, modules: ['dashboard', 'pos'] }

    const bad = await call('/users', { body: { ...body, phone: '123' }, token })
    expect(bad.status).toBe(400)
    expect((await json<{ error: { message: string } }>(bad)).error.message).toMatch(/10-digit/)

    const created = await call('/users', { body, token })
    expect(created.status).toBe(201)
    expect((await call('/users', { body, token })).status).toBe(409)
    expect((await login('9847099999', '5555')).user).toMatchObject({ name: 'Anjali Varghese', modules: ['dashboard', 'pos'] })
  })

  it('access changes are audited; the owner cannot lock themselves out', async () => {
    const { token } = await login(OWNER)
    const res = await call('/users/u2', { method: 'PATCH', body: { modules: ['dashboard', 'pos', 'users'] }, token })
    expect(res.status).toBe(200)
    const rows = await db.select().from(auditLog).where(eq(auditLog.entityId, 'u2'))
    expect(rows.at(-1)).toMatchObject({ action: 'Access changed', userId: 'u1' })

    expect((await call('/users/u1', { method: 'PATCH', body: { modules: ['dashboard'] }, token })).status).toBe(400)
  })

  it('only the owner can change users, even with the users module', async () => {
    const manager = await login(MANAGER) // now has 'users' from the previous test
    expect((await call('/users', { token: manager.token })).status).toBe(200)
    expect((await call('/users/u3', { method: 'PATCH', body: { salary: 1 }, token: manager.token })).status).toBe(403)
  })

  it('deactivating a user ends their access at once', async () => {
    const victim = await login(MANAGER)
    const { token } = await login(OWNER)
    await call('/users/u2', { method: 'PATCH', body: { active: false }, token })
    expect((await call('/auth/me', { token: victim.token })).status).toBe(401)
    expect((await call('/auth/refresh', { method: 'POST', cookie: victim.cookie })).status).toBe(401)
    expect((await call('/auth/login', { body: { phone: MANAGER, pin: '1234' } })).status).toBe(401)
  })
})
