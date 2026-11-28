import { and, asc, eq, lt, sql } from 'drizzle-orm'
import type { z } from 'zod'
import { db, type Tx } from '../../db'
import { purchases, supplierPayments, suppliers, trips } from '../../db/schema'
import { audit } from '../../lib/audit'
import type { UserRow } from '../../lib/auth'
import { reserve } from '../../lib/counters'
import { AppError, conflict } from '../../lib/errors'
import { applyMoves } from '../../lib/stock'
import { allocateFifo, round2 } from '../../shared/billing'
import type { purchaseInput, supplierPaymentInput } from '../../shared/schemas'

type PurchaseRow = typeof purchases.$inferSelect
const DAY = 86_400_000
const rupees = (n: number) => `₹${n.toLocaleString('en-IN')}`
const toPurchase = (p: PurchaseRow) => ({ ...p, date: p.date.toISOString() })

async function supplierOf(tx: Tx, id: string) {
  const [s] = await tx.select().from(suppliers).where(eq(suppliers.id, id))
  if (!s) throw new AppError('unknown_supplier', 'Pick a supplier from the list')
  return s
}

// Same rule as the purchase dialog's trip picker: only trips that have started bring back stock.
async function checkTrip(tx: Tx, id: string | undefined) {
  if (!id) return
  const [t] = await tx.select({ status: trips.status }).from(trips).where(eq(trips.id, id))
  if (!t || t.status === 'planned') throw new AppError('invalid_trip', 'Pick a trip that has started')
}

// A purchase bill = one transaction: the bill, stock into the chosen channel (ledger), any amount paid now
// (recorded as a supplier payment, so payments always add up to `paid`) and the audit row.
export async function addPurchase(by: UserRow, input: z.infer<typeof purchaseInput>) {
  const total = round2(input.items.reduce((t, i) => t + i.qty * i.cost, 0))
  const date = input.date ?? new Date()
  if (input.paid > total) throw new AppError('over_payment', `Paid can't be more than the bill (${rupees(total)})`)
  if (date.getTime() > Date.now() + DAY) throw new AppError('future_date', 'The bill date is in the future')
  return db.transaction(async (tx) => {
    const id = `pu${await reserve(tx, 'purchase')}`
    const supplier = await supplierOf(tx, input.supplierId)
    const [dup] = await tx.select({ id: purchases.id }).from(purchases).where(and(eq(purchases.supplierId, supplier.id), eq(purchases.billNo, input.billNo)))
    if (dup) throw conflict(`Bill ${input.billNo} from ${supplier.name} is already entered`)
    await checkTrip(tx, input.tripId)

    const [row] = await tx.insert(purchases).values({ ...input, id, date, total }).returning()
    const stock = await applyMoves(tx, by.id, input.items.map((i) => ({ variantId: i.variantId, channel: input.channel, qty: i.qty, kind: 'purchase' as const, refId: id })))
    if (input.paid > 0) {
      await tx.insert(supplierPayments).values({ supplierId: supplier.id, date, amount: input.paid, allocations: [{ purchaseId: id, amount: input.paid }], userId: by.id })
    }
    await audit(tx, { userId: by.id, action: 'Purchase entry', detail: `${input.billNo} · ${rupees(total)}`, entity: 'purchase', entityId: id })
    return { purchase: toPurchase(row!), variants: [...stock.values()] }
  })
}

// Locks the supplier's unpaid bills and settles them oldest first. Paying more than is due is refused.
export function paySupplier(by: UserRow, { supplierId, amount }: z.infer<typeof supplierPaymentInput>) {
  return db.transaction(async (tx) => {
    const supplier = await supplierOf(tx, supplierId)
    const open = await tx.select().from(purchases).where(and(eq(purchases.supplierId, supplierId), lt(purchases.paid, purchases.total)))
      .orderBy(asc(purchases.date), asc(purchases.id)).for('update')
    const due = round2(open.reduce((t, p) => t + p.total - p.paid, 0))
    if (amount > due) throw new AppError('over_payment', due ? `Only ${rupees(due)} is due to ${supplier.name}` : `Nothing is due to ${supplier.name}`)

    const allocations = allocateFifo(open.map(toPurchase), amount)
    const updated = []
    for (const a of allocations) {
      const [p] = await tx.update(purchases).set({ paid: sql`${purchases.paid} + ${a.amount}` }).where(eq(purchases.id, a.purchaseId)).returning()
      updated.push(toPurchase(p!))
    }
    const [payment] = await tx.insert(supplierPayments).values({ supplierId, amount, allocations, userId: by.id }).returning()
    await audit(tx, { userId: by.id, action: 'Supplier payment', detail: `${supplier.name} · ${rupees(amount)}`, entity: 'supplier', entityId: supplierId })
    return { payment: { ...payment!, date: payment!.date.toISOString() }, purchases: updated }
  })
}

export const listPurchases = async () => (await db.select().from(purchases).orderBy(asc(purchases.date), asc(purchases.id))).map(toPurchase)
