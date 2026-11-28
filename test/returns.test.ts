import { and, eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { db } from '../src/db'
import { auditLog, stockMovements } from '../src/db/schema'
import { seed } from '../src/db/seed'
import { computeBill, gstRateFor, returnLineAmount } from '../src/shared/billing'
import { buildSeed } from '../src/shared/seed'
import type { CreditNote, Product, ReturnEntry, Sale, Variant } from '../src/shared/types'
import { call, json, login, OWNER } from './helpers'

const CASHIER = '9847033333' // pos + returns
const PURCHASE = '9847055555' // neither
const demo = buildSeed()
let cashier: string
let owner: string
beforeAll(async () => {
  await seed()
  cashier = (await login(CASHIER)).token
  owner = (await login(OWNER)).token
})

interface Done { return: ReturnEntry; sale: Sale; variants: Variant[]; creditNote?: CreditNote }
const giveBack = (body: Record<string, unknown>, token = cashier) => call('/returns', { body, token })
const errorOf = async (res: Response) => (await json<{ error: { code: string; message: string } }>(res)).error
const variantOf = async (id: string) => (await json<Variant[]>(await call('/variants', { token: owner }))).find((v) => v.id === id)!

// A fresh bill with an offer, so refunds are visibly pro-rata (less than the sticker price).
const used = new Set<string>()
async function freshBill(customerId = demo.customers[9]!.id) {
  const [vs, ps] = await Promise.all([json<Variant[]>(await call('/variants', { token: owner })), json<Product[]>(await call('/products', { token: owner }))])
  const price = new Map(ps.map((p) => [p.id, p.price]))
  const [a, b] = vs.filter((v) => v.stockOffline >= 3 && !used.has(v.id) && price.get(v.productId)! >= 600).slice(0, 2)
  used.add(a!.id).add(b!.id)
  const items = [a!, b!].map((v, i) => ({ price: price.get(v.productId)!, qty: i ? 1 : 2, gstRate: gstRateFor(price.get(v.productId)!) }))
  const offer = demo.offers.find((o) => o.code === 'WELCOME10')!
  const { total } = computeBill(items, { offer })
  const res = await call('/sales/checkout', {
    body: { lines: [{ variantId: a!.id, qty: 2 }, { variantId: b!.id, qty: 1 }], customerId, offerCode: 'WELCOME10', payments: [{ mode: 'card', amount: total }] },
    token: cashier,
  })
  expect(res.status).toBe(201)
  return { sale: (await json<{ sale: Sale }>(res)).sale, a: a!, b: b! }
}

describe('returns', () => {
  it('refunds the pro-rata share, puts stock back through the ledger and marks the bill', async () => {
    const { sale, a } = await freshBill()
    const res = await giveBack({ saleId: sale.id, items: [{ variantId: a.id, qty: 1 }], mode: 'refund', reason: 'Size too small' })
    expect(res.status).toBe(201)
    const done = await json<Done>(res)
    const line = sale.items.find((i) => i.variantId === a.id)!
    const expected = returnLineAmount(line.price, 1, sale)
    expect(expected).toBeLessThan(line.price)
    expect(done.return).toMatchObject({ mode: 'refund', amount: expected, items: [{ variantId: a.id, qty: 1, amount: expected }], creditNoteNo: null, userId: 'u3' })
    expect(done.sale.status).toBe('partial-return')
    expect(done.sale.items.find((i) => i.variantId === a.id)!.returnedQty).toBe(1)
    expect(done.variants[0]!.stockOffline).toBe(a.stockOffline - 2 + 1)
    const moves = await db.select().from(stockMovements).where(and(eq(stockMovements.refId, done.return.id), eq(stockMovements.kind, 'return')))
    expect(moves).toEqual([expect.objectContaining({ variantId: a.id, channel: 'store', qty: 1 })])
    const [last] = await db.select().from(auditLog).where(eq(auditLog.entityId, done.return.id))
    expect(last).toMatchObject({ action: 'Refund', detail: `${sale.invoiceNo} · ₹${expected}` })
  })

  it('issues a credit note for the rest, closes the bill, and the note can pay a new bill', async () => {
    const { sale, a, b } = await freshBill()
    const done = await json<Done>(await giveBack({ saleId: sale.id, items: [{ variantId: a.id, qty: 1 }, { variantId: b.id, qty: 1 }, { variantId: a.id, qty: 1 }], mode: 'credit-note', reason: 'Changed mind' }))
    const amount = sale.items.reduce((t, i) => t + returnLineAmount(i.price, i.qty, sale), 0)
    expect(done.sale.status).toBe('returned')
    expect(done.creditNote).toMatchObject({ no: done.return.creditNoteNo, customerId: sale.customerId, amount, balance: amount })
    expect(Number(done.creditNote!.no.slice(3))).toBeGreaterThan(Math.max(...demo.creditNotes.map((c) => Number(c.no.slice(3)))))

    const notes = await json<CreditNote[]>(await call('/credit-notes', { token: cashier }))
    expect(notes.find((c) => c.no === done.creditNote!.no)).toMatchObject({ balance: amount })
    const pay = Math.min(amount, sale.items[0]!.price)
    const reuse = await call('/sales/checkout', {
      body: { lines: [{ variantId: a.id, qty: 1 }], payments: [{ mode: 'credit-note', amount: pay }, ...(sale.items[0]!.price > pay ? [{ mode: 'cash', amount: sale.items[0]!.price - pay }] : [])], creditNoteNo: done.creditNote!.no },
      token: cashier,
    })
    expect((await json<{ creditNote: CreditNote }>(reuse)).creditNote.balance).toBe(amount - pay)
  })

  it('takes exchanges back without money or a note, into the bill’s own channel', async () => {
    const online = demo.sales.find((s) => s.channel === 'online' && s.status === 'paid')!
    const it0 = online.items[0]!
    const before = await variantOf(it0.variantId)
    const done = await json<Done>(await giveBack({ saleId: online.id, items: [{ variantId: it0.variantId, qty: 1 }], mode: 'exchange', reason: 'Size too large' }))
    expect(done.return).toMatchObject({ mode: 'exchange', creditNoteNo: null })
    expect(done.creditNote).toBeUndefined()
    expect(await variantOf(it0.variantId)).toMatchObject({ stockOnline: before.stockOnline + 1, stockOffline: before.stockOffline })
  })

  it('refuses over-returns, items not on the bill and unknown bills, without burning a credit-note number', async () => {
    const { sale, a, b } = await freshBill()
    const base = { saleId: sale.id, mode: 'credit-note', reason: 'Defect at seam' }
    const cases: [Record<string, unknown>, number, string][] = [
      [{ ...base, items: [{ variantId: a.id, qty: 3 }] }, 400, 'over_return'],
      [{ ...base, items: [{ variantId: demo.variants[0]!.id, qty: 1 }] }, 400, 'not_on_bill'],
      [{ ...base, saleId: 'nope', items: [{ variantId: a.id, qty: 1 }] }, 404, 'not_found'],
      [{ ...base, items: [] }, 400, 'invalid_input'],
      [{ ...base, mode: 'cash', items: [{ variantId: a.id, qty: 1 }] }, 400, 'invalid_input'],
    ]
    const notesBefore = (await json<CreditNote[]>(await call('/credit-notes', { token: owner }))).length
    for (const [body, status, code] of cases) {
      const res = await giveBack(body)
      expect([res.status, (await errorOf(res)).code]).toEqual([status, code])
    }
    const first = await json<Done>(await giveBack({ ...base, items: [{ variantId: b.id, qty: 1 }] }))
    expect((await errorOf(await giveBack({ ...base, items: [{ variantId: b.id, qty: 1 }] }))).message).toBe(`${b.id} was already returned`)
    const second = await json<Done>(await giveBack({ ...base, items: [{ variantId: a.id, qty: 1 }] }))
    expect(Number(second.creditNote!.no.slice(3))).toBe(Number(first.creditNote!.no.slice(3)) + 1) // gapless
    expect(await json<CreditNote[]>(await call('/credit-notes', { token: owner }))).toHaveLength(notesBefore + 2)
  })

  it('lets only one of two racing returns take the last unit', async () => {
    const { sale, b } = await freshBill()
    const body = { saleId: sale.id, items: [{ variantId: b.id, qty: 1 }], mode: 'refund', reason: 'Changed mind' }
    const results = await Promise.all([giveBack(body), giveBack(body)])
    expect(results.map((r) => r.status).sort()).toEqual([201, 400])
  })

  it('needs returns or pos access, and lists history newest first', async () => {
    const { sale, a } = await freshBill()
    expect((await giveBack({ saleId: sale.id, items: [{ variantId: a.id, qty: 1 }], mode: 'refund', reason: 'x' }, (await login(PURCHASE)).token)).status).toBe(403)
    const list = await json<ReturnEntry[]>(await call('/returns', { token: cashier }))
    expect(list.length).toBeGreaterThan(demo.returns.length)
    expect(list.map((r) => r.date)).toEqual(list.map((r) => r.date).sort().reverse())
    for (const r of demo.returns) expect(list.find((x) => x.id === r.id)).toMatchObject({ saleId: r.saleId, amount: r.amount, mode: r.mode })
  })
})

describe('returnLineAmount', () => {
  it('scales by what the bill actually charged', () => {
    expect(returnLineAmount(1000, 1, { total: 900, subtotal: 1000 })).toBe(900)
    expect(returnLineAmount(799, 2, { total: 1438, subtotal: 1598 })).toBe(1438)
    expect(returnLineAmount(500, 1, { total: 0, subtotal: 0 })).toBe(500)
  })
})
