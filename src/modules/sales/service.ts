import { and, asc, eq, gte, inArray, lt, sql, type SQL } from 'drizzle-orm'
import type { z } from 'zod'
import { db, type Tx } from '../../db'
import { creditNotes, customers, offers, products, saleItems, sales, variants } from '../../db/schema'
import { audit } from '../../lib/audit'
import type { UserRow } from '../../lib/auth'
import { reserve } from '../../lib/counters'
import { AppError, notFound } from '../../lib/errors'
import { applyMoves, mergeQty } from '../../lib/stock'
import { gstRateFor, pointsEarned } from '../../shared/billing'
import type { checkoutInput } from '../../shared/schemas'
import type { Sale, SaleItem } from '../../shared/types'
import { getSettings } from '../settings/service'
import { checkPayments, financialYear, priceBill } from './bill'

type CheckoutInput = z.infer<typeof checkoutInput>
type SaleRow = typeof sales.$inferSelect
type ItemRow = typeof saleItems.$inferSelect

// API shape = the frontend Sale type (a walk-in has no customerId, a bill without an offer no offerCode).
export const toSale = (s: SaleRow, items: ItemRow[]): Sale => ({
  ...s, date: s.date.toISOString(), customerId: s.customerId ?? undefined, offerCode: s.offerCode ?? undefined,
  items: items.map(({ id: _id, saleId: _sale, ...it }) => it),
})

// Prices and costs come from the DB, never from the client.
async function priceLines(tx: Tx, lines: { variantId: string; qty: number }[]): Promise<SaleItem[]> {
  const rows = await tx.select({ v: variants, p: products }).from(variants)
    .innerJoin(products, eq(products.id, variants.productId)).where(inArray(variants.id, lines.map((l) => l.variantId)))
  const bySku = new Map(rows.map((r) => [r.v.id, r]))
  return lines.map(({ variantId, qty }) => {
    const r = bySku.get(variantId)
    if (!r) throw notFound(`SKU ${variantId}`)
    const { p, v } = r
    return { variantId, productId: p.id, name: p.name, size: v.size, color: v.color, qty, price: p.price, cost: p.cost, gstRate: gstRateFor(p.price) }
  })
}

async function offerFor(tx: Tx, code: string | undefined, subtotal: number) {
  if (!code) return undefined
  const [o] = await tx.select().from(offers).where(eq(offers.code, code))
  if (!o) throw new AppError('invalid_offer', 'Invalid offer code')
  if (!o.active) throw new AppError('invalid_offer', 'This offer has expired')
  if (subtotal < o.minBill) throw new AppError('invalid_offer', `Needs a bill of ₹${o.minBill}+`)
  return o
}

async function lockCustomer(tx: Tx, id: string | undefined) {
  if (!id) return undefined
  const [c] = await tx.select().from(customers).where(eq(customers.id, id)).for('update')
  if (!c) throw notFound('Customer')
  return c
}

async function spendCreditNote(tx: Tx, no: string | undefined, amount: number) {
  if (!amount || !no) return undefined
  const [cn] = await tx.select().from(creditNotes).where(eq(creditNotes.no, no)).for('update')
  if (!cn) throw notFound(`Credit note ${no}`)
  if (amount > cn.balance) throw new AppError('credit_note_balance', `Credit note ${no} has only ₹${cn.balance} left`)
  const [after] = await tx.update(creditNotes).set({ balance: sql`${creditNotes.balance} - ${amount}` }).where(eq(creditNotes.no, no)).returning()
  return after
}

// One store bill = one transaction: numbers, stock, points, credit note and audit commit together or not at all,
// so a failed bill gives its invoice number back (gapless). Lock order matches every other flow
// (counters → variants → customer → credit note), so parallel tills queue instead of deadlocking.
export async function checkout(by: UserRow, input: CheckoutInput) {
  const settings = await getSettings()
  return db.transaction(async (tx) => {
    const now = new Date()
    const fy = financialYear(now)
    const id = `s${await reserve(tx, 'sale')}`
    const invoiceNo = `HS/${fy}/${String(await reserve(tx, `invoice:${fy}`)).padStart(5, '0')}`

    const items = await priceLines(tx, mergeQty(input.lines))
    const offer = await offerFor(tx, input.offerCode, items.reduce((t, i) => t + i.price * i.qty, 0))
    const stock = await applyMoves(tx, by.id, items.map((i) => ({ variantId: i.variantId, channel: 'store' as const, qty: -i.qty, kind: 'sale' as const, refId: id })))
    const customer = await lockCustomer(tx, input.customerId)
    const { bill, pointsUsed } = priceBill(items, offer, input, customer?.loyaltyPoints ?? 0, settings)
    const creditNote = await spendCreditNote(tx, input.creditNoteNo, checkPayments(input.payments, bill.total, input.creditNoteNo))

    const [sale] = await tx.insert(sales).values({
      id, invoiceNo, date: now, channel: 'store', customerId: customer?.id,
      subtotal: bill.subtotal, discount: bill.discount, offerCode: bill.offerDiscount ? offer?.code : null,
      pointsRedeemed: bill.pointsRedeemed, taxTotal: bill.taxTotal, total: bill.total,
      payments: input.payments, cashierId: by.id, interState: input.interState,
    }).returning()
    const itemRows = await tx.insert(saleItems).values(items.map((i) => ({ ...i, saleId: id }))).returning()
    const [updatedCustomer] = customer
      ? await tx.update(customers).set({ loyaltyPoints: customer.loyaltyPoints - pointsUsed + pointsEarned(bill.total, settings.pointsPer100) })
        .where(eq(customers.id, customer.id)).returning()
      : []
    await audit(tx, { userId: by.id, action: 'Bill created', detail: `${invoiceNo} · ₹${bill.total.toLocaleString('en-IN')}`, entity: 'sale', entityId: id })
    return { sale: toSale(sale!, itemRows), variants: [...stock.values()], customer: updatedCustomer, creditNote }
  })
}

async function salesWhere(where?: SQL) {
  const [rows, items] = await Promise.all([
    db.select().from(sales).where(where).orderBy(asc(sales.date), asc(sales.id)),
    db.select({ item: saleItems }).from(saleItems).innerJoin(sales, eq(sales.id, saleItems.saleId)).where(where).orderBy(asc(saleItems.id)),
  ])
  const bySale = Map.groupBy(items.map((r) => r.item), (i) => i.saleId)
  return rows.map((s) => toSale(s, bySale.get(s.id) ?? []))
}

// All sales, or those dated in [from, to) for reports.
export const listSales = (range?: { from: Date; to: Date }) => salesWhere(range && and(gte(sales.date, range.from), lt(sales.date, range.to)))
export const salesByIds = async (ids: string[]) => (ids.length ? salesWhere(inArray(sales.id, ids)) : [])

export const listCreditNotes = () => db.select().from(creditNotes).orderBy(asc(creditNotes.date), asc(creditNotes.no))
