import { and, eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { db } from '../src/db'
import { stockMovements } from '../src/db/schema'
import { seed } from '../src/db/seed'
import { financialYear } from '../src/modules/sales/bill'
import { computeBill, gstRateFor, pointsEarned } from '../src/shared/billing'
import { buildSeed } from '../src/shared/seed'
import type { CreditNote, Customer, Product, Sale, Variant } from '../src/shared/types'
import { call, json, login, OWNER } from './helpers'

const CASHIER = '9847033333' // u3, pos
const PURCHASE = '9847055555' // no pos
const demo = buildSeed()
const storeBills = demo.sales.filter((s) => s.channel === 'store').length
let cashier: string
let owner: string
beforeAll(async () => {
  await seed()
  cashier = (await login(CASHIER)).token
  owner = (await login(OWNER)).token
})

interface Result { sale: Sale; variants: Variant[]; customer?: Customer; creditNote?: CreditNote }
type Body = Record<string, unknown>
const sell = (body: Body, token = cashier) => call('/sales/checkout', { body, token })
const errorOf = async (res: Response) => (await json<{ error: { code: string; message: string } }>(res)).error
const live = async () => {
  const [vs, ps] = await Promise.all([json<Variant[]>(await call('/variants', { token: owner })), json<Product[]>(await call('/products', { token: owner }))])
  return { vs, price: new Map(ps.map((p) => [p.id, p.price])) }
}
// Variants with enough store stock, cheapest first, skipping ones other tests use.
const used = new Set<string>()
async function pick(minStock: number, n = 1) {
  const { vs, price } = await live()
  const out = vs.filter((v) => v.stockOffline >= minStock && !used.has(v.id)).slice(0, n)
  out.forEach((v) => used.add(v.id))
  return out.map((v) => ({ ...v, price: price.get(v.productId)! }))
}
const customerOf = async (id: string) => (await json<Customer[]>(await call('/customers', { token: owner }))).find((c) => c.id === id)!
const invoiceSeq = (s: Sale) => Number(s.invoiceNo.split('/')[2])

describe('checkout', () => {
  it('prices from the DB, merges repeated scans, takes stock through the ledger and adds points', async () => {
    const [a, b] = await pick(3, 2)
    const c = demo.customers[5]!
    const before = await customerOf(c.id)
    const items = [{ price: a!.price, qty: 2, gstRate: gstRateFor(a!.price) }, { price: b!.price, qty: 1, gstRate: gstRateFor(b!.price) }]
    const expected = computeBill(items)
    const res = await sell({
      lines: [{ variantId: a!.id, qty: 1, price: 1 }, { variantId: b!.id, qty: 1 }, { variantId: a!.id, qty: 1 }], // client price ignored
      customerId: c.id, payments: [{ mode: 'upi', amount: expected.total }],
    })
    expect(res.status).toBe(201)
    const { sale, variants, customer } = await json<Result>(res)
    expect(sale).toMatchObject({ invoiceNo: `HS/${financialYear(new Date())}/${String(storeBills + 1).padStart(5, '0')}`, total: expected.total, taxTotal: expected.taxTotal, cashierId: 'u3', status: 'paid' })
    expect(sale.items.map((i) => [i.variantId, i.qty])).toEqual([[a!.id, 2], [b!.id, 1]])
    expect(variants.find((v) => v.id === a!.id)!.stockOffline).toBe(a!.stockOffline - 2)
    expect(customer!.loyaltyPoints).toBe(before.loyaltyPoints + pointsEarned(expected.total, demo.settings.pointsPer100))
    const moves = await db.select().from(stockMovements).where(and(eq(stockMovements.refId, sale.id), eq(stockMovements.kind, 'sale')))
    expect(moves.map((m) => m.qty).sort((x, y) => x - y)).toEqual([-2, -1])
  })

  it('applies offer → manual → points like the POS screen, and spends the points', async () => {
    const [v] = await pick(2)
    const c = demo.customers.find((x) => x.loyaltyPoints >= 50)!
    const before = await customerOf(c.id)
    const qty = Math.ceil(1100 / v!.price)
    const items = [{ price: v!.price, qty, gstRate: gstRateFor(v!.price) }]
    const offer = demo.offers.find((o) => o.code === 'WELCOME10')!
    const expected = computeBill(items, { offer, manualDiscount: 50, pointsRedeemed: 40 * demo.settings.pointValue })
    const res = await sell({
      lines: [{ variantId: v!.id, qty }], customerId: c.id, offerCode: 'welcome10', manualDiscount: 50, pointsToRedeem: 40,
      payments: [{ mode: 'cash', amount: expected.total - 100 }, { mode: 'card', amount: 100 }],
    })
    expect(res.status).toBe(201)
    const { sale, customer } = await json<Result>(res)
    expect(sale).toMatchObject({ offerCode: 'WELCOME10', discount: expected.discount, pointsRedeemed: expected.pointsRedeemed, total: expected.total })
    expect(customer!.loyaltyPoints).toBe(before.loyaltyPoints - 40 + pointsEarned(expected.total, demo.settings.pointsPer100))
  })

  // The note comes from a real return: demo credit-note balances depend on the time of day the seed runs.
  it('spends a credit note and refuses to overdraw it', async () => {
    const [v] = await pick(2)
    const total = computeBill([{ price: v!.price, qty: 1, gstRate: gstRateFor(v!.price) }]).total
    const line = [{ variantId: v!.id, qty: 1 }]
    const bought = (await json<Result>(await sell({ lines: line, payments: [{ mode: 'cash', amount: total }] }))).sale
    const issued = await call('/returns', { body: { saleId: bought.id, items: line, mode: 'credit-note', reason: 'Size too small' }, token: cashier })
    const cn = (await json<{ creditNote: CreditNote }>(issued)).creditNote
    expect(cn.balance).toBe(total)

    const res = await sell({ lines: line, payments: [{ mode: 'credit-note', amount: total }], creditNoteNo: cn.no.toLowerCase() })
    expect(res.status).toBe(201)
    expect((await json<Result>(res)).creditNote).toMatchObject({ no: cn.no, balance: 0 })

    const over = await sell({ lines: line, payments: [{ mode: 'credit-note', amount: total }], creditNoteNo: cn.no })
    expect(await errorOf(over)).toEqual({ code: 'credit_note_balance', message: `Credit note ${cn.no} has only ₹0 left` })
    expect((await call('/credit-notes', { token: cashier })).status).toBe(200)
  })

  it('rejects bad bills, and a rejected bill neither moves stock nor burns an invoice number', async () => {
    const [v] = await pick(2)
    const total = computeBill([{ price: v!.price, qty: 1, gstRate: gstRateFor(v!.price) }]).total
    const line = [{ variantId: v!.id, qty: 1 }]
    const ok = (await json<Result>(await sell({ lines: line, payments: [{ mode: 'cash', amount: total }] }))).sale

    const cases: [Body, number, string][] = [
      [{ lines: line, payments: [{ mode: 'cash', amount: total - 1 }] }, 400, 'payment_mismatch'],
      [{ lines: line, payments: [{ mode: 'cash', amount: total }], offerCode: 'NOPE' }, 400, 'invalid_offer'],
      [{ lines: line, payments: [{ mode: 'cash', amount: total }], offerCode: 'MONSOON20' }, 400, 'invalid_offer'],
      [{ lines: line, payments: [{ mode: 'cash', amount: total }], pointsToRedeem: 5 }, 400, 'not_enough_points'], // walk-in has no points
      [{ lines: line, payments: [{ mode: 'credit-note', amount: total }] }, 400, 'invalid_payment'],
      [{ lines: [{ variantId: v!.id, qty: v!.stockOffline + 1 }], payments: [{ mode: 'cash', amount: total }] }, 409, 'conflict'],
      [{ lines: [{ variantId: 'NOPE-1', qty: 1 }], payments: [] }, 404, 'not_found'],
      [{ lines: [], payments: [] }, 400, 'invalid_input'],
    ]
    for (const [body, status, code] of cases) {
      const res = await sell(body)
      expect([res.status, (await errorOf(res)).code]).toEqual([status, code])
    }
    expect((await live()).vs.find((x) => x.id === v!.id)!.stockOffline).toBe(v!.stockOffline - 1)

    const next = (await json<Result>(await sell({ lines: line, payments: [{ mode: 'cash', amount: total }] }))).sale
    expect(invoiceSeq(next)).toBe(invoiceSeq(ok) + 1) // gapless
  })

  it('needs the pos module', async () => {
    expect((await sell({ lines: [{ variantId: 'X', qty: 1 }], payments: [] }, (await login(PURCHASE)).token)).status).toBe(403)
  })
})

describe('parallel tills', () => {
  it('never oversells the last unit', async () => {
    const { vs, price } = await live()
    const v = vs.find((x) => x.stockOffline === 1 && !used.has(x.id))!
    used.add(v.id)
    const total = computeBill([{ price: price.get(v.productId)!, qty: 1, gstRate: gstRateFor(price.get(v.productId)!) }]).total
    const body = { lines: [{ variantId: v.id, qty: 1 }], payments: [{ mode: 'upi', amount: total }] }
    const results = await Promise.all([sell(body), sell(body), sell(body)])
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409])
  })

  it('gives concurrent bills distinct, consecutive invoice numbers', async () => {
    const vs = await pick(1, 5)
    const results = await Promise.all(vs.map((v) => {
      const total = computeBill([{ price: v.price, qty: 1, gstRate: gstRateFor(v.price) }]).total
      return sell({ lines: [{ variantId: v.id, qty: 1 }], payments: [{ mode: 'cash', amount: total }] })
    }))
    const seqs = (await Promise.all(results.map((r) => json<Result>(r)))).map((r) => invoiceSeq(r.sale)).sort((a, b) => a - b)
    expect(seqs).toEqual(seqs.map((_, i) => seqs[0]! + i))
  })
})

describe('sales history', () => {
  it('serves the demo sales with their items', async () => {
    const list = await json<Sale[]>(await call('/sales', { token: owner }))
    expect(list.length).toBeGreaterThan(demo.sales.length)
    const first = demo.sales[0]!
    expect(list.find((s) => s.id === first.id)).toMatchObject({ invoiceNo: first.invoiceNo, total: first.total, items: first.items.map((i) => expect.objectContaining({ variantId: i.variantId, qty: i.qty })) })
  })
})

describe('financialYear', () => {
  it('switches on 1 April, Indian time', () => {
    expect(financialYear(new Date('2026-03-31T18:29:00Z'))).toBe('25-26') // 23:59 IST, 31 March
    expect(financialYear(new Date('2026-03-31T18:30:00Z'))).toBe('26-27') // 00:00 IST, 1 April
    expect(financialYear(new Date('2099-12-31T00:00:00Z'))).toBe('99-00')
  })
})
