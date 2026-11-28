import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { db } from '../src/db'
import { auditLog, settings } from '../src/db/schema'
import { seed } from '../src/db/seed'
import { SETTINGS } from '../src/shared/seed'
import { call, json, login, OWNER } from './helpers'

const CASHIER = '9847033333' // u3: dashboard, pos, returns, customers, barcodes
const PURCHASE = '9847055555' // u5: has inventory, not settings

let owner: string
beforeAll(async () => {
  await seed()
  owner = (await login(OWNER)).token
})

describe('settings', () => {
  it('every logged-in user can read; anonymous cannot', async () => {
    const { token } = await login(CASHIER)
    expect(await json(await call('/settings', { token }))).toEqual(SETTINGS)
    expect((await call('/settings')).status).toBe(401)
  })

  it('only the settings module can change them', async () => {
    const { token } = await login(CASHIER)
    expect((await call('/settings', { method: 'PATCH', body: { pointsPer100: 2 }, token })).status).toBe(403)
  })

  it('saves one section at a time and normalises the GSTIN', async () => {
    const res = await call('/settings', { method: 'PATCH', body: { pointsPer100: 2, gstin: '32aakfh4821r1z9' }, token: owner })
    expect(res.status).toBe(200)
    expect(await json(res)).toMatchObject({ pointsPer100: 2, gstin: '32AAKFH4821R1Z9', shopName: SETTINGS.shopName })
    expect(await json(await call('/settings', { token: owner }))).toMatchObject({ pointsPer100: 2 })
  })

  it('rejects bad input and empty patches', async () => {
    const bad = await call('/settings', { method: 'PATCH', body: { gstin: 'NOTAGSTIN' }, token: owner })
    expect(bad.status).toBe(400)
    expect((await json<{ error: { message: string } }>(bad)).error.message).toMatch(/GSTIN/)
    expect((await call('/settings', { method: 'PATCH', body: {}, token: owner })).status).toBe(400)
    expect((await call('/settings', { method: 'PATCH', body: { deadStockDays: 0 }, token: owner })).status).toBe(400)
  })

  it('a fresh database falls back to the shop defaults, and the first save creates the row', async () => {
    await db.delete(settings)
    expect(await json(await call('/settings', { token: owner }))).toEqual(SETTINGS)
    await call('/settings', { method: 'PATCH', body: { tagline: 'New season' }, token: owner })
    expect(await json(await call('/settings', { token: owner }))).toEqual({ ...SETTINGS, tagline: 'New season' })
  })
})

describe('offers', () => {
  const diwali = { type: 'percent', value: 25, minBill: 2000, active: true, description: 'Diwali sale' }

  it('lists the seeded offers to any logged-in user', async () => {
    const { token } = await login(CASHIER)
    const list = await json<{ code: string }[]>(await call('/offers', { token }))
    expect(list.map((o) => o.code)).toEqual(['FESTIVE500', 'HOLY15', 'MONSOON20', 'WELCOME10'])
  })

  it('creates (201) then updates (200); codes are uppercased; both are audited', async () => {
    const a = await call('/offers/diwali25', { method: 'PUT', body: diwali, token: owner })
    expect(a.status).toBe(201)
    expect(await json(a)).toMatchObject({ code: 'DIWALI25', value: 25 })

    const b = await call('/offers/DIWALI25', { method: 'PUT', body: { ...diwali, active: false }, token: owner })
    expect(b.status).toBe(200)
    expect(await json(b)).toMatchObject({ active: false })

    const logs = await db.select().from(auditLog).where(eq(auditLog.entityId, 'DIWALI25'))
    expect(logs.map((l) => l.action)).toEqual(['Offer created', 'Offer updated'])
  })

  it('rejects percent over 100, zero value and bad codes', async () => {
    expect((await call('/offers/BIG', { method: 'PUT', body: { ...diwali, value: 150 }, token: owner })).status).toBe(400)
    expect((await call('/offers/ZERO', { method: 'PUT', body: { ...diwali, value: 0 }, token: owner })).status).toBe(400)
    expect((await call('/offers/x!', { method: 'PUT', body: diwali, token: owner })).status).toBe(400)
  })

  it('inventory staff can launch CLEAR30; cashiers cannot change offers', async () => {
    const clear = { type: 'percent', value: 30, minBill: 0, active: true, description: 'Clearance on dead stock' }
    expect((await call('/offers/CLEAR30', { method: 'PUT', body: clear, token: (await login(PURCHASE)).token })).status).toBe(201)
    expect((await call('/offers/CLEAR30', { method: 'PUT', body: clear, token: (await login(CASHIER)).token })).status).toBe(403)
  })
})
