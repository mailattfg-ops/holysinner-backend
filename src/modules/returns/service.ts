import { asc, desc, eq, sql } from 'drizzle-orm'
import type { z } from 'zod'
import { db } from '../../db'
import { creditNotes, returns, saleItems, sales } from '../../db/schema'
import { audit } from '../../lib/audit'
import type { UserRow } from '../../lib/auth'
import { reserve } from '../../lib/counters'
import { AppError, notFound } from '../../lib/errors'
import { applyMoves, mergeQty } from '../../lib/stock'
import { returnLineAmount } from '../../shared/billing'
import type { returnInput } from '../../shared/schemas'
import { toSale } from '../sales/service'

type ItemRow = typeof saleItems.$inferSelect
type ReturnRow = typeof returns.$inferSelect

const ACTION = { refund: 'Refund', exchange: 'Exchange', 'credit-note': 'Credit note issued' } as const
const toReturn = (r: ReturnRow) => ({ ...r, date: r.date.toISOString() })

// Each picked line must be on the bill and not returned already; it refunds its pro-rata share of what was paid.
function returnLines(items: ItemRow[], sale: { invoiceNo: string; total: number; subtotal: number }, picked: { variantId: string; qty: number }[]) {
  return picked.map(({ variantId, qty }) => {
    const item = items.find((i) => i.variantId === variantId)
    if (!item) throw new AppError('not_on_bill', `${variantId} is not on bill ${sale.invoiceNo}`)
    const left = item.qty - item.returnedQty
    if (qty > left) throw new AppError('over_return', left ? `Only ${left} of ${variantId} can still be returned` : `${variantId} was already returned`)
    return { item, variantId, qty, amount: returnLineAmount(item.price, qty, sale) }
  })
}

// One return = one transaction: stock back to the bill's channel, returned qty and status on the bill,
// the credit note (if any), the return row and the audit row. Lock order: counters → bill → variants.
export function processReturn(by: UserRow, input: z.infer<typeof returnInput>) {
  return db.transaction(async (tx) => {
    const id = `r${await reserve(tx, 'return')}`
    const creditNoteNo = input.mode === 'credit-note' ? `CN-${await reserve(tx, 'cn')}` : null
    const [sale] = await tx.select().from(sales).where(eq(sales.id, input.saleId)).for('update')
    if (!sale) throw notFound('Bill')
    const items = await tx.select().from(saleItems).where(eq(saleItems.saleId, sale.id)).orderBy(asc(saleItems.id)).for('update')
    const lines = returnLines(items, sale, mergeQty(input.items))
    const amount = lines.reduce((t, l) => t + l.amount, 0)

    const stock = await applyMoves(tx, by.id, lines.map((l) => ({ variantId: l.variantId, channel: sale.channel, qty: l.qty, kind: 'return' as const, refId: id })))
    for (const l of lines) {
      await tx.update(saleItems).set({ returnedQty: sql`${saleItems.returnedQty} + ${l.qty}` }).where(eq(saleItems.id, l.item.id))
      l.item.returnedQty += l.qty
    }
    const status = items.every((i) => i.returnedQty >= i.qty) ? 'returned' : 'partial-return'
    const [updatedSale] = await tx.update(sales).set({ status }).where(eq(sales.id, sale.id)).returning()
    const [creditNote] = creditNoteNo
      ? await tx.insert(creditNotes).values({ no: creditNoteNo, customerId: sale.customerId, amount, balance: amount }).returning()
      : []
    const [row] = await tx.insert(returns).values({
      id, saleId: sale.id, items: lines.map(({ variantId, qty, amount: a }) => ({ variantId, qty, amount: a })),
      mode: input.mode, amount, creditNoteNo, reason: input.reason, userId: by.id,
    }).returning()
    await audit(tx, { userId: by.id, action: ACTION[input.mode], detail: `${sale.invoiceNo} · ₹${amount}`, entity: 'return', entityId: id })
    return { return: toReturn(row!), sale: toSale(updatedSale!, items), variants: [...stock.values()], creditNote }
  })
}

export const listReturns = async () => (await db.select().from(returns).orderBy(desc(returns.date), desc(returns.id))).map(toReturn)
