// Tills racing each other on a REAL Postgres (npm run test:pg). The same races in the PGlite suite run one
// transaction after another, so they'd pass even with every FOR UPDATE removed; here the transactions overlap.
import { beforeAll, describe, expect, it } from 'vitest'
import { dbKind } from '../src/db'
import { seed } from '../src/db/seed'
import type { Product, Purchase, Sale, Variant } from '../src/shared/types'
import { call, json, login, OWNER } from './helpers'

let owner: string
beforeAll(async () => {
  await seed()
  owner = (await login(OWNER)).token
})

const live = async () => {
  const [vs, ps] = await Promise.all([json<Variant[]>(await call('/variants', { token: owner })), json<Product[]>(await call('/products', { token: owner }))])
  const price = new Map(ps.map((p) => [p.id, p.price]))
  return { vs, price: (v: Variant) => price.get(v.productId)! }
}
const used = new Set<string>()
const pick = async (minStore: number) => {
  const { vs, price } = await live()
  const v = vs.find((x) => x.stockOffline >= minStore && !used.has(x.id))!
  used.add(v.id)
  return { v, price: price(v) }
}
const setStore = (v: Variant, to: number) =>
  call('/stock/adjust', { token: owner, body: { variantId: v.id, channel: 'store', delta: to - v.stockOffline, reason: 'race test setup' } })
const sell = (lines: { variantId: string; qty: number }[], total: number) =>
  call('/sales/checkout', { token: owner, body: { lines, payments: [{ mode: 'cash', amount: total }] } })
const statuses = (rs: Response[]) => rs.map((r) => r.status).sort()

describe('races on real Postgres', () => {
  it('runs on a real server, not PGlite', () => expect(dbKind).toBe('postgres'))

  it('10 tills sell the last 3 units at once: exactly 3 bills, stock 0, never negative', async () => {
    const { v, price } = await pick(4)
    expect((await setStore(v, 3)).status).toBe(200)
    const rs = await Promise.all(Array.from({ length: 10 }, () => sell([{ variantId: v.id, qty: 1 }], price)))
    expect(statuses(rs)).toEqual([...Array(3).fill(201), ...Array(7).fill(409)])
    expect((await live()).vs.find((x) => x.id === v.id)!.stockOffline).toBe(0)
  })

  it('8 bills at once get 8 consecutive invoice numbers (no duplicates, no gaps)', async () => {
    const { v, price } = await pick(10)
    const rs = await Promise.all(Array.from({ length: 8 }, () => sell([{ variantId: v.id, qty: 1 }], price)))
    expect(rs.every((r) => r.status === 201)).toBe(true)
    const nos = (await Promise.all(rs.map((r) => json<{ sale: Sale }>(r)))).map((r) => Number(r.sale.invoiceNo.split('/')[2])).sort((a, b) => a - b)
    expect(nos).toEqual(Array.from({ length: 8 }, (_, i) => nos[0]! + i))
  })

  it('two tills buying the same two items in opposite order never deadlock', async () => {
    const a = await pick(2), b = await pick(2)
    await setStore(a.v, 20); await setStore(b.v, 20)
    const ab = [{ variantId: a.v.id, qty: 1 }, { variantId: b.v.id, qty: 1 }]
    const total = Math.round(a.price + b.price)
    const rs = await Promise.all(Array.from({ length: 10 }, (_, i) => sell(i % 2 ? ab : [...ab].reverse(), total)))
    expect(statuses(rs)).toEqual(Array(10).fill(201)) // a deadlock would surface as a 500
  })

  it('two returns of the last unit at once: one refund, one refused, refunds within the bill total', async () => {
    const { v, price } = await pick(2)
    const bill = await json<{ sale: Sale }>(await sell([{ variantId: v.id, qty: 1 }], price))
    const rs = await Promise.all([1, 2].map(() =>
      call('/returns', { token: owner, body: { saleId: bill.sale.id, items: [{ variantId: v.id, qty: 1 }], mode: 'refund', reason: 'Size issue' } })))
    expect(statuses(rs)).toEqual([201, 400])
  })

  it('10 supplier payments at once can never pay more than is due', async () => {
    const sup = await json<{ id: string }>(await call('/suppliers', { token: owner, body: { name: 'Race Supplier', city: 'Surat', state: 'Gujarat', phone: '', gstin: '' } }))
    const { v } = await pick(1)
    await call('/purchases', { token: owner, body: { billNo: 'RACE/1', supplierId: sup.id, items: [{ variantId: v.id, qty: 4, cost: 250 }], paid: 0, channel: 'store' } })
    // 10 × ₹150 = ₹1,500 against ₹1,000 due: at most 6 fit
    const rs = await Promise.all(Array.from({ length: 10 }, () => call('/purchases/payments', { token: owner, body: { supplierId: sup.id, amount: 150 } })))
    const codes = rs.map((r) => r.status)
    expect(codes.every((c) => c === 201 || c === 400)).toBe(true) // no 500 from a broken CHECK
    const bill = (await json<Purchase[]>(await call('/purchases', { token: owner }))).find((p) => p.billNo === 'RACE/1')!
    expect(bill.paid).toBe(150 * codes.filter((c) => c === 201).length)
    expect(bill.paid).toBeLessThanOrEqual(bill.total)
  })

  it('two transfers of the last store unit at once: one moves it, one is refused', async () => {
    const { v } = await pick(2)
    await setStore(v, 1)
    const rs = await Promise.all([1, 2].map(() => call('/stock/transfer', { token: owner, body: { variantId: v.id, qty: 1, from: 'store' } })))
    expect(statuses(rs)).toEqual([201, 409])
  })

  it('30 wrong PINs at once lock the account; one refresh cookie used twice at once gives one session', async () => {
    const cashier = '9847044444'
    await Promise.all(Array.from({ length: 30 }, () => call('/auth/login', { body: { phone: cashier, pin: '9999' } })))
    expect((await call('/auth/login', { body: { phone: cashier, pin: '1234' } })).status).toBe(401) // locked: right PIN refused

    const { cookie } = await login(OWNER)
    const both = await Promise.all([1, 2].map(() => call('/auth/refresh', { method: 'POST', cookie })))
    expect(statuses(both)).toEqual([200, 401])
  })
})
