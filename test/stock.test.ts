import { eq, sql } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { db } from '../src/db'
import { auditLog, stockMovements } from '../src/db/schema'
import { seed } from '../src/db/seed'
import { buildSeed } from '../src/shared/seed'
import type { Transfer, Variant } from '../src/shared/types'
import { call, json, login, OWNER } from './helpers'

const CASHIER = '9847033333' // no inventory / online
const demo = buildSeed()
let owner: string
beforeAll(async () => {
  await seed()
  owner = (await login(OWNER)).token
})

const live = async () => json<Variant[]>(await call('/variants', { token: owner }))
const variantOf = async (id: string) => (await live()).find((v) => v.id === id)!
const ledgerOf = (variantId: string) => db.select().from(stockMovements).where(eq(stockMovements.variantId, variantId))
// A variant with enough store stock right now; demo.variants[0] is left alone for the validation tests.
const stocked = async (min: number) => (await live()).find((v) => v.stockOffline >= min && v.id !== demo.variants[0]!.id)!

describe('stock adjust', () => {
  it('changes one channel, writes a ledger row with the reason, and audits', async () => {
    const v = await stocked(3)
    const res = await call('/stock/adjust', { body: { variantId: v.id, channel: 'store', delta: -2, reason: 'Damaged' }, token: owner })
    expect(res.status).toBe(200)
    expect(await json<Variant>(res)).toMatchObject({ id: v.id, stockOffline: v.stockOffline - 2, stockOnline: v.stockOnline })
    expect(await ledgerOf(v.id)).toContainEqual(expect.objectContaining({ channel: 'store', qty: -2, kind: 'adjust', reason: 'Damaged', userId: 'u1' }))
    const [last] = await db.select().from(auditLog).orderBy(sql`${auditLog.id} desc`).limit(1)
    expect(last).toMatchObject({ action: 'Stock adjusted', detail: `${v.id} · store -2 (Damaged)` })
  })

  it('refuses to go below zero and leaves balance and ledger untouched', async () => {
    const v = await variantOf(demo.variants[1]!.id)
    const before = (await ledgerOf(v.id)).length
    const res = await call('/stock/adjust', { body: { variantId: v.id, channel: 'online', delta: -(v.stockOnline + 1), reason: 'Recount' }, token: owner })
    expect(res.status).toBe(409)
    expect((await json<{ error: { message: string } }>(res)).error.message).toBe(`Only ${v.stockOnline} left of ${v.id} in online`)
    expect(await variantOf(v.id)).toEqual(v)
    expect(await ledgerOf(v.id)).toHaveLength(before)
  })

  it('validates input and access', async () => {
    const body = { variantId: demo.variants[0]!.id, channel: 'store', delta: 1, reason: 'Recount' }
    expect((await call('/stock/adjust', { body: { ...body, delta: 0 }, token: owner })).status).toBe(400)
    expect((await call('/stock/adjust', { body: { ...body, reason: ' ' }, token: owner })).status).toBe(400)
    expect((await call('/stock/adjust', { body: { ...body, channel: 'warehouse' }, token: owner })).status).toBe(400)
    expect((await call('/stock/adjust', { body: { ...body, variantId: 'NOPE-1' }, token: owner })).status).toBe(404)
    expect((await call('/stock/adjust', { body, token: (await login(CASHIER)).token })).status).toBe(403)
  })
})

describe('stock transfer', () => {
  it('moves units between channels as two legs that net to zero, and lists it first', async () => {
    const v = await stocked(4)
    const res = await call('/stock/transfer', { body: { variantId: v.id, qty: 3, from: 'store' }, token: owner })
    expect(res.status).toBe(201)
    const { transfer, variant } = await json<{ transfer: Transfer; variant: Variant }>(res)
    expect(variant).toMatchObject({ stockOffline: v.stockOffline - 3, stockOnline: v.stockOnline + 3 })
    expect(transfer).toMatchObject({ id: `tr${demo.transfers.length + 1}`, variantId: v.id, qty: 3, from: 'store', userId: 'u1' })

    const legs = (await ledgerOf(v.id)).filter((m) => m.refId === transfer.id)
    expect(legs.map((m) => [m.channel, m.qty]).sort()).toEqual([['online', 3], ['store', -3]])

    const list = await json<Transfer[]>(await call('/stock/transfers', { token: owner }))
    expect(list).toHaveLength(demo.transfers.length + 1) // the 10 demo transfers are seeded
    expect(list[0]).toMatchObject({ id: transfer.id, qty: 3, from: 'store' })
  })

  it('never oversells when two moves race for the same units', async () => {
    const v = await stocked(2)
    const body = { variantId: v.id, qty: v.stockOffline, from: 'store' }
    const results = await Promise.all([call('/stock/transfer', { body, token: owner }), call('/stock/transfer', { body, token: owner })])
    expect(results.map((r) => r.status).sort()).toEqual([201, 409])
    expect(await variantOf(v.id)).toMatchObject({ stockOffline: 0, stockOnline: v.stockOnline + v.stockOffline })
  })

  it('needs inventory or online access', async () => {
    const cashier = (await login(CASHIER)).token
    expect((await call('/stock/transfers', { token: cashier })).status).toBe(403)
    expect((await call('/stock/transfer', { body: { variantId: demo.variants[0]!.id, qty: 1, from: 'store' }, token: cashier })).status).toBe(403)
    expect((await call('/stock/transfer', { body: { variantId: demo.variants[0]!.id, qty: 0, from: 'store' }, token: owner })).status).toBe(400)
  })
})

describe('opening stock', () => {
  it('records a new product’s opening stock in the ledger, so the ledger sums to the balance', async () => {
    const body = {
      name: 'Linen Shirt', brand: 'Holysinner', category: 'Shirts', gender: 'Men', hsn: '6205',
      cost: 500, price: 1199, supplierId: 'sup1', sizes: ['M'], colors: ['Beige'], stock: 5,
    }
    const { variants } = await json<{ variants: Variant[] }>(await call('/products', { body, token: owner }))
    const id = variants[0]!.id
    expect(variants[0]).toMatchObject({ stockOffline: 5 })
    expect(await ledgerOf(id)).toEqual([expect.objectContaining({ channel: 'store', qty: 5, kind: 'opening' })])

    await call('/stock/transfer', { body: { variantId: id, qty: 2, from: 'store' }, token: owner })
    await call('/stock/adjust', { body: { variantId: id, channel: 'online', delta: -1, reason: 'Gift' }, token: owner })
    const ledger = await ledgerOf(id)
    const sum = (ch: string) => ledger.filter((m) => m.channel === ch).reduce((t, m) => t + m.qty, 0)
    expect(await variantOf(id)).toMatchObject({ stockOffline: sum('store'), stockOnline: sum('online') })
  })
})
