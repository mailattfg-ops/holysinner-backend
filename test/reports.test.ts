import { beforeAll, describe, expect, it } from 'vitest'
import { seed } from '../src/db/seed'
import { computeBill, gstRateFor, gstReport, gstTables, type GstReport } from '../src/shared/billing'
import { buildSeed } from '../src/shared/seed'
import type { Customer, Product, ReturnEntry, Sale, SaleItem, Settings, Variant } from '../src/shared/types'
import { call, json, login, MANAGER, OWNER } from './helpers'

const CASHIER = '9847033333' // u3: pos, no finance/analytics
const PURCHASE = '9847055555' // u5: purchases/inventory, no finance or analytics
const demo = buildSeed()
let owner: string
beforeAll(async () => {
  await seed()
  owner = (await login(OWNER)).token
})

const gstOf = async (from: Date, to: Date, token = owner) =>
  call(`/reports/gst?from=${from.toISOString()}&to=${to.toISOString()}`, { token })
const reportOf = async (from: Date, to: Date) => json<GstReport>(await gstOf(from, to))
const taxOf = (r: GstReport) => r.totals.cgst + r.totals.sgst + r.totals.igst

const item = (p: Partial<SaleItem>): SaleItem => ({
  variantId: 'V1', productId: 'p1', name: 'Tee', size: 'M', color: 'Black', qty: 1, price: 1000, cost: 400, gstRate: 5, ...p,
})
const bill = (p: Partial<Sale>): Sale => ({
  id: 's1', invoiceNo: 'HS/26-27/00001', date: '2026-11-01T10:00:00.000Z', channel: 'store', items: [item({})], subtotal: 1000,
  discount: 0, pointsRedeemed: 0, taxTotal: 47.62, total: 1000, payments: [], cashierId: 'u1', interState: false, status: 'paid', ...p,
})

describe('gstReport (shared maths)', () => {
  it('reports what the invoice charged: offer, manual discount and points all lower the taxable value', () => {
    const lines = [{ price: 1200, qty: 2, gstRate: 5 }, { price: 3000, qty: 1, gstRate: 18 }]
    const b = computeBill(lines, { manualDiscount: 100, pointsRedeemed: 250 })
    const sale = bill({
      items: [item({ price: 1200, qty: 2 }), item({ variantId: 'V2', productId: 'p2', price: 3000, gstRate: 18 })],
      subtotal: b.subtotal, discount: b.discount, pointsRedeemed: b.pointsRedeemed, taxTotal: b.taxTotal, total: b.total,
    })
    const r = gstReport([sale], [], (id) => (id === 'p1' ? '6109' : '6205'))
    expect(taxOf(r)).toBeCloseTo(b.taxTotal, 1) // the old screen added points back and overstated this
    expect(r.totals.taxable).toBeCloseTo(b.taxable, 1)
    expect(r.hsn.map((h) => [h.hsn, h.rate, h.qty])).toEqual([['6109', 5, 2], ['6205', 18, 1]])
  })

  it('splits intra-state into CGST + SGST and inter-state into IGST', () => {
    const r = gstReport([bill({}), bill({ id: 's2', invoiceNo: '#SHP1', channel: 'online', interState: true })], [], () => '6109')
    expect(r.b2cs.map((x) => x.supply)).toEqual(['Inter-state', 'Intra-state'])
    const [inter, intra] = r.b2cs
    expect(inter!.igst).toBeCloseTo(47.62, 2)
    expect(inter!.cgst + inter!.sgst).toBe(0)
    expect(intra!.cgst).toBeCloseTo(23.81, 2)
    expect(intra!.igst).toBe(0)
  })

  it('subtracts a return in its own period at the rate of the returned line, and leaves the invoice in full', () => {
    const sale = bill({ items: [item({ qty: 2 })], subtotal: 2000, total: 2000, taxTotal: 95.24 })
    const entry: ReturnEntry = { id: 'r1', saleId: 's1', date: '2026-12-02T10:00:00.000Z', items: [{ variantId: 'V1', qty: 1, amount: 1000 }], mode: 'refund', amount: 1000, reason: 'Size', userId: 'u1' }
    const november = gstReport([{ ...sale, items: [item({ qty: 2, returnedQty: 1 })] }], [], () => '6109')
    const december = gstReport([], [{ entry, sale }], () => '6109')
    expect(taxOf(november)).toBeCloseTo(95.24, 2) // returnedQty on the bill doesn't change the month it was sold in
    expect(december.totals.taxable).toBeCloseTo(-952.38, 2)
    expect(december.hsn[0]!.qty).toBe(-1)
  })

  it('lists document series with first, last and count, numbering numerically', () => {
    const sales = ['#SHP999', '#SHP1000', 'HS/26-27/00002', 'HS/26-27/00001'].map((invoiceNo, i) => bill({ id: `s${i}`, invoiceNo }))
    const entry: ReturnEntry = { id: 'r1', saleId: 's0', date: '', items: [], mode: 'credit-note', amount: 0, creditNoteNo: 'CN-101', reason: '', userId: 'u1' }
    expect(gstReport(sales, [{ entry, sale: sales[0]! }], () => '').documents).toEqual([
      { series: '#SHP', first: '#SHP999', last: '#SHP1000', count: 2 },
      { series: 'CN-', first: 'CN-101', last: 'CN-101', count: 1 },
      { series: 'HS/26-27/', first: 'HS/26-27/00001', last: 'HS/26-27/00002', count: 2 },
    ])
  })

  it('turns the report into accountant tables', () => {
    const t = gstTables(gstReport([bill({})], [], () => '6109'), 'Kerala')
    expect(t.hsn.columns[0]).toBe('HSN')
    expect(t.hsn.rows).toEqual([['6109', 5, 1, 952.38, 23.81, 23.81, 0, 47.62]])
    expect(t.b2cs.rows[0]!.slice(0, 3)).toEqual(['Intra-state', 'Kerala', 5])
  })
})

describe('GET /reports/gst', () => {
  const now = new Date()
  const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const hsnOf = (id: string) => demo.products.find((p) => p.id === id)!.hsn
  const inRange = (d: string, from: Date, to: Date) => new Date(d) >= from && new Date(d) < to

  it('equals the shared gstReport over the demo data for last month', async () => {
    const sales = demo.sales.filter((s) => inRange(s.date, lastMonth, thisMonth))
    const returns = demo.returns.filter((r) => inRange(r.date, lastMonth, thisMonth)).map((entry) => ({ entry, sale: demo.sales.find((s) => s.id === entry.saleId)! }))
    const want = gstReport(sales, returns, hsnOf)
    const got = await reportOf(lastMonth, thisMonth)
    expect(got.totals.taxable).toBeCloseTo(want.totals.taxable, 1)
    expect(taxOf(got)).toBeCloseTo(taxOf(want), 1)
    expect(got.hsn.length).toBe(want.hsn.length)
    expect(got.documents).toEqual(want.documents)
    expect(got.totals.taxable).toBeGreaterThan(0)
  })

  it('moves by exactly a new bill\'s tax, points included; a later return lowers today and never last month', async () => {
    const [vs, ps, cs, settings] = await Promise.all([
      json<Variant[]>(await call('/variants', { token: owner })), json<Product[]>(await call('/products', { token: owner })),
      json<Customer[]>(await call('/customers', { token: owner })), json<Settings>(await call('/settings', { token: owner })),
    ])
    const v = vs.find((x) => x.stockOffline >= 2 && ps.find((p) => p.id === x.productId)!.price <= 2500)!
    const price = ps.find((p) => p.id === v.productId)!.price
    const c = cs.find((x) => x.loyaltyPoints >= 50)!
    const points = 40
    const expected = computeBill([{ price, qty: 2, gstRate: gstRateFor(price) }], { pointsRedeemed: points * settings.pointValue })
    const tomorrow = new Date(Date.now() + 86_400_000)
    const lastMonthBefore = await reportOf(lastMonth, thisMonth)
    const before = await reportOf(thisMonth, tomorrow)

    const res = await call('/sales/checkout', {
      token: owner,
      body: { lines: [{ variantId: v.id, qty: 2 }], customerId: c.id, pointsToRedeem: points, payments: [{ mode: 'cash', amount: expected.total }] },
    })
    expect(res.status).toBe(201)
    const { sale } = await json<{ sale: Sale }>(res)
    const after = await reportOf(thisMonth, tomorrow)
    expect(taxOf(after) - taxOf(before)).toBeCloseTo(sale.taxTotal, 1)
    expect(after.documents.find((d) => d.series.startsWith('HS/'))!.last).toBe(sale.invoiceNo)

    const ret = await call('/returns', { token: owner, body: { saleId: sale.id, items: [{ variantId: v.id, qty: 1 }], mode: 'refund', reason: 'Size issue' } })
    expect(ret.status).toBe(201)
    const { return: entry } = await json<{ return: ReturnEntry }>(ret)
    const afterReturn = await reportOf(thisMonth, tomorrow)
    const refundTax = entry.amount - entry.amount / (1 + gstRateFor(price) / 100)
    expect(taxOf(after) - taxOf(afterReturn)).toBeCloseTo(refundTax, 1)
    expect(await reportOf(lastMonth, thisMonth)).toEqual(lastMonthBefore) // a filed month doesn't move
  })

  it('is readable with finance or analytics only, and validates the range', async () => {
    expect((await gstOf(lastMonth, thisMonth, (await login(MANAGER)).token)).status).toBe(200) // analytics
    expect((await gstOf(lastMonth, thisMonth, (await login(CASHIER)).token)).status).toBe(403)
    expect((await gstOf(lastMonth, thisMonth, (await login(PURCHASE)).token)).status).toBe(403)
    expect((await gstOf(thisMonth, lastMonth)).status).toBe(400)
    expect((await call('/reports/gst', { token: owner })).status).toBe(400)
  })
})
