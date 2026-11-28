import { and, eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { db } from '../src/db'
import { stockMovements, supplierPayments } from '../src/db/schema'
import { seed } from '../src/db/seed'
import { allocateFifo } from '../src/shared/billing'
import { buildSeed } from '../src/shared/seed'
import type { Purchase, Supplier, Variant } from '../src/shared/types'
import { call, json, login, OWNER } from './helpers'

const PURCHASE = '9847055555' // u5, purchases
const CASHIER = '9847033333' // no purchases
const demo = buildSeed()
let buyer: string
let owner: string
beforeAll(async () => {
  await seed()
  buyer = (await login(PURCHASE)).token
  owner = (await login(OWNER)).token
})

interface Paid { payment: { amount: number; allocations: { purchaseId: string; amount: number }[] }; purchases: Purchase[] }
const errorOf = async (res: Response) => (await json<{ error: { code: string; message: string } }>(res)).error
const variantOf = async (id: string) => (await json<Variant[]>(await call('/variants', { token: owner }))).find((v) => v.id === id)!
const billsOf = async (supplierId: string) => (await json<Purchase[]>(await call('/purchases', { token: owner }))).filter((p) => p.supplierId === supplierId)
const dueOf = (bills: Purchase[]) => bills.reduce((t, p) => t + p.total - p.paid, 0)
const pay = (supplierId: string, amount: number) => call('/purchases/payments', { body: { supplierId, amount }, token: buyer })

// A supplier of our own, so the FIFO maths isn't mixed up with demo bills.
async function newSupplier(name: string) {
  return json<Supplier>(await call('/suppliers', { body: { name, city: 'Erode', state: 'Tamil Nadu' }, token: owner }))
}
const bill = (supplierId: string, billNo: string, cost: number, date: string, extra: Record<string, unknown> = {}) =>
  call('/purchases', { body: { billNo, supplierId, date, items: [{ variantId: demo.variants[3]!.id, qty: 10, cost }], ...extra }, token: buyer })

describe('purchase entry', () => {
  it('records the bill, brings stock into the chosen channel through the ledger, and books what was paid', async () => {
    const [v1, v2] = [demo.variants[1]!, demo.variants[2]!]
    const [b1, b2] = [await variantOf(v1.id), await variantOf(v2.id)]
    const res = await call('/purchases', {
      body: { billNo: 'SUR/9001', supplierId: 'sup1', channel: 'online', paid: 1000, items: [{ variantId: v1.id, qty: 5, cost: 410.5 }, { variantId: v2.id, qty: 3, cost: 300 }] },
      token: buyer,
    })
    expect(res.status).toBe(201)
    const { purchase } = await json<{ purchase: Purchase }>(res)
    expect(purchase).toMatchObject({ id: `pu${demo.purchases.length + 1}`, total: 2952.5, paid: 1000, channel: 'online' })
    expect(await variantOf(v1.id)).toMatchObject({ stockOnline: b1.stockOnline + 5, stockOffline: b1.stockOffline })
    expect((await variantOf(v2.id)).stockOnline).toBe(b2.stockOnline + 3)
    const moves = await db.select().from(stockMovements).where(and(eq(stockMovements.refId, purchase.id), eq(stockMovements.kind, 'purchase')))
    expect(moves).toHaveLength(2)
    const pays = await db.select().from(supplierPayments).where(eq(supplierPayments.supplierId, 'sup1'))
    expect(pays.at(-1)).toMatchObject({ amount: 1000, allocations: [{ purchaseId: purchase.id, amount: 1000 }] })
  })

  it('refuses a duplicate supplier bill, overpaying, future dates, unknown suppliers and SKUs', async () => {
    const ok = { billNo: 'TIR/7001', supplierId: 'sup2', items: [{ variantId: demo.variants[0]!.id, qty: 1, cost: 100 }] }
    expect((await call('/purchases', { body: ok, token: buyer })).status).toBe(201)
    const cases: [Record<string, unknown>, number, string][] = [
      [ok, 409, 'conflict'],
      [{ ...ok, billNo: 'TIR/7002', paid: 101 }, 400, 'over_payment'],
      [{ ...ok, billNo: 'TIR/7003', date: new Date(Date.now() + 3 * 86_400_000).toISOString() }, 400, 'future_date'],
      [{ ...ok, billNo: 'TIR/7004', supplierId: 'nope' }, 400, 'unknown_supplier'],
      [{ ...ok, billNo: 'TIR/7005', items: [{ variantId: 'NOPE-1', qty: 1, cost: 1 }] }, 404, 'not_found'],
      [{ ...ok, billNo: 'TIR/7006', items: [] }, 400, 'invalid_input'],
    ]
    for (const [body, status, code] of cases) {
      const res = await call('/purchases', { body, token: buyer })
      expect([res.status, (await errorOf(res)).code]).toEqual([status, code])
    }
    expect((await errorOf(await call('/purchases', { body: ok, token: buyer }))).message).toBe('Bill TIR/7001 from Tiruppur Knits Co. is already entered')
    expect((await call('/purchases', { body: { ...ok, billNo: 'TIR/7007' }, token: (await login(CASHIER)).token })).status).toBe(403)
  })
})

describe('supplier payments', () => {
  it('settle the oldest unpaid bills first and refuse to pay more than is due', async () => {
    const s = await newSupplier('Erode Weaves')
    for (const [no, cost, date] of [['E/2', 300, '2026-10-02T06:30:00.000Z'], ['E/1', 200, '2026-10-01T06:30:00.000Z'], ['E/3', 100, '2026-10-03T06:30:00.000Z']] as const) {
      expect((await bill(s.id, no, cost, date)).status).toBe(201) // ₹2000, ₹3000, ₹1000 bills, entered out of order
    }
    const res = await pay(s.id, 2500)
    expect(res.status).toBe(201)
    const { payment } = await json<Paid>(res)
    const bills = await billsOf(s.id)
    const byNo = (no: string) => bills.find((p) => p.billNo === no)!
    expect(payment.allocations).toEqual([{ purchaseId: byNo('E/1').id, amount: 2000 }, { purchaseId: byNo('E/2').id, amount: 500 }])
    expect([byNo('E/1').paid, byNo('E/2').paid, byNo('E/3').paid]).toEqual([2000, 500, 0])

    const over = await pay(s.id, 3501)
    expect(await errorOf(over)).toEqual({ code: 'over_payment', message: 'Only ₹3,500 is due to Erode Weaves' })
    expect((await pay(s.id, 3500)).status).toBe(201)
    expect(dueOf(await billsOf(s.id))).toBe(0)
    expect((await errorOf(await pay(s.id, 1))).message).toBe('Nothing is due to Erode Weaves')
  })

  it('never lets two parallel payments overpay', async () => {
    const s = await newSupplier('Karur Linens')
    await bill(s.id, 'K/1', 100, '2026-10-01T06:30:00.000Z') // ₹1000 due
    const results = await Promise.all([pay(s.id, 700), pay(s.id, 700)])
    expect(results.map((r) => r.status).sort()).toEqual([201, 400])
    expect(dueOf(await billsOf(s.id))).toBe(300)
  })

  it('keep payments adding up to what each bill shows as paid (demo data included)', async () => {
    const [bills, pays] = await Promise.all([json<Purchase[]>(await call('/purchases', { token: owner })), db.select().from(supplierPayments)])
    const allocated = new Map<string, number>()
    for (const p of pays) for (const a of p.allocations) allocated.set(a.purchaseId, (allocated.get(a.purchaseId) ?? 0) + a.amount)
    for (const b of bills) expect([b.id, allocated.get(b.id) ?? 0]).toEqual([b.id, b.paid])
    expect(bills.length).toBeGreaterThanOrEqual(demo.purchases.length)
  })

  it('need the purchases module', async () => {
    expect((await call('/purchases/payments', { body: { supplierId: 'sup1', amount: 1 }, token: (await login(CASHIER)).token })).status).toBe(403)
    expect((await call('/purchases', { token: (await login(CASHIER)).token })).status).toBe(403)
  })
})

describe('allocateFifo', () => {
  it('pays oldest first, stops at the amount, and skips settled bills', () => {
    const bills = [
      { id: 'b', date: '2026-02-01', total: 500, paid: 0 },
      { id: 'a', date: '2026-01-01', total: 300, paid: 300 },
      { id: 'c', date: '2026-03-01', total: 400.5, paid: 100 },
    ]
    expect(allocateFifo(bills, 600.25)).toEqual([{ purchaseId: 'b', amount: 500 }, { purchaseId: 'c', amount: 100.25 }])
    expect(allocateFifo(bills, 10_000)).toEqual([{ purchaseId: 'b', amount: 500 }, { purchaseId: 'c', amount: 300.5 }])
    expect(allocateFifo(bills, 0)).toEqual([])
  })
})

describe('money inputs', () => {
  it('refuses fractions of a paisa with a clear 400 (they used to round in the DB: a 500, or a 1-paisa mismatch)', async () => {
    for (const amount of [0.004, 99.995]) {
      const res = await pay('sup1', amount)
      expect(res.status).toBe(400)
      expect((await json<{ error: { message: string } }>(res)).error.message).toMatch(/2 decimals/)
    }
  })
})
