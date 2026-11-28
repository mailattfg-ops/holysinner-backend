// Loads the frontend's demo data (shared/seed.ts) so the API serves the same story. Idempotent: existing rows are kept.
// Grows one slice per build step.
import { eq } from 'drizzle-orm'
import { db, type Tx } from '.'
import { bumpTo } from '../lib/counters'
import { hashPin } from '../modules/auth/service'
import { tripCost } from '../shared/money'
import { buildSeed, type SeedData } from '../shared/seed'
import type { Channel } from '../shared/types'
import { auditLog, creditNotes, customers, expenses, offers, products, purchases, returns, salaryPayments, saleItems, sales, settings, stockMovements, supplierPayments, suppliers, trips, users, variants } from './schema'

export const DEMO_PIN = '1234' // ponytail: one shared demo PIN; real staff get their own PIN from the owner (PUT /users/:id/pin)

const num = (id: string) => Number(id.replace(/\D/g, '')) || 0
const BATCH = 500 // keeps each insert well under Postgres' parameter limit

async function insertAll<T>(rows: T[], insert: (chunk: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += BATCH) await insert(rows.slice(i, i + BATCH))
}

// Sales and their items go in once (items have serial ids, so a re-run must not add them twice).
async function seedSales(tx: Tx, data: SeedData) {
  if ((await tx.select({ id: sales.id }).from(sales).limit(1)).length) return
  await insertAll(data.sales, (chunk) => tx.insert(sales).values(chunk.map(({ items: _items, ...s }) => ({ ...s, date: new Date(s.date) }))))
  const items = data.sales.flatMap((s) => s.items.map((i) => ({ ...i, saleId: s.id, returnedQty: i.returnedQty ?? 0 })))
  await insertAll(items, (chunk) => tx.insert(saleItems).values(chunk))
  if (data.creditNotes.length) await tx.insert(creditNotes).values(data.creditNotes.map((c) => ({ ...c, date: new Date(c.date) })))
  // Invoices continue after the demo numbering, per financial year (HS/26-27/…), #SHP…, CN-…
  const store = Map.groupBy(data.sales.filter((x) => x.channel === 'store'), (x) => x.invoiceNo.split('/')[1]!)
  for (const [fy, list] of store) await bumpTo(tx, `invoice:${fy}`, Math.max(...list.map((x) => num(x.invoiceNo.split('/')[2]!))))
  await bumpTo(tx, 'shopify', Math.max(1000, ...data.sales.filter((x) => x.channel === 'online').map((x) => num(x.invoiceNo))))
  await bumpTo(tx, 'cn', Math.max(100, ...data.creditNotes.map((c) => num(c.no))))
  await bumpTo(tx, 'sale', Math.max(...data.sales.map((x) => num(x.id))))
}

// Demo bills keep their paid amounts; each gets one matching payment row so payments always add up to `paid`.
async function seedPurchases(tx: Tx, data: SeedData) {
  if ((await tx.select({ id: purchases.id }).from(purchases).limit(1)).length) return
  await tx.insert(purchases).values(data.purchases.map((p) => ({ ...p, date: new Date(p.date) })))
  const paid = data.purchases.filter((p) => p.paid > 0)
  if (paid.length) await tx.insert(supplierPayments).values(paid.map((p) => ({ supplierId: p.supplierId, date: new Date(p.date), amount: p.paid, allocations: [{ purchaseId: p.id, amount: p.paid }] })))
  await bumpTo(tx, 'purchase', Math.max(0, ...data.purchases.map((p) => num(p.id))))
}

// Everything the demo builds after its sales loop depends on the hour it was built (today's bill count shifts the
// random sequence). So these go only into empty tables: a later re-seed must not mix rows from two builds
// (that's how three returns pointing at items not on their bills reached Supabase on 2026-11-28).
async function seedBackOffice(tx: Tx, data: SeedData) {
  const empty = async (table: Parameters<Tx['$count']>[0]) => (await tx.$count(table)) === 0
  if (await empty(trips)) {
    await tx.insert(trips).values(data.trips.map((t) => ({
      ...t, startDate: new Date(t.startDate), endDate: new Date(t.endDate),
      ...(t.status === 'settled' && { settled: tripCost(t), settledAt: new Date(t.endDate) }), // frozen, as settling does
    })))
  }
  await seedPurchases(tx, data)
  if (await empty(expenses)) await tx.insert(expenses).values(data.expenses.map((e) => ({ ...e, date: new Date(e.date) })))
  if (await empty(salaryPayments)) await tx.insert(salaryPayments).values(data.salaryPayments.map((p) => ({ ...p, paidOn: new Date(p.paidOn) })))
  if (await empty(returns) && data.returns.length) await tx.insert(returns).values(data.returns.map((x) => ({ ...x, date: new Date(x.date) })))
  // Demo activity is marked entity 'demo', because the log also holds real actions.
  if (!(await tx.$count(auditLog, eq(auditLog.entity, 'demo')))) {
    await tx.insert(auditLog).values(data.audit.map((a) => ({ at: new Date(a.date), userId: a.userId, action: a.action, detail: a.detail, entity: 'demo' })))
  }
  for (const [key, ids] of [['trip', data.trips], ['expense', data.expenses], ['salary', data.salaryPayments], ['return', data.returns]] as const) {
    await bumpTo(tx, key, Math.max(0, ...ids.map((x) => num(x.id))))
  }
}

export async function seed() {
  const data = buildSeed()
  const pinHash = await hashPin(DEMO_PIN)
  await db.transaction(async (tx) => {
    await tx.insert(users).values(data.users.map((u) => ({ ...u, pinHash }))).onConflictDoNothing()
    await tx.insert(settings).values({ ...data.settings, id: 1 }).onConflictDoNothing()
    await tx.insert(offers).values(data.offers).onConflictDoNothing()
    await tx.insert(suppliers).values(data.suppliers).onConflictDoNothing()
    await tx.insert(products).values(data.products.map((p) => ({ ...p, createdAt: new Date(p.createdAt) }))).onConflictDoNothing()
    await insertAll(data.variants, (chunk) => tx.insert(variants).values(chunk).onConflictDoNothing())
    await insertAll(data.customers, (chunk) => tx.insert(customers).values(chunk.map((c) => ({ ...c, createdAt: new Date(c.createdAt) }))).onConflictDoNothing())
    // ponytail: demo balances pre-date the ledger, so only the demo transfers are seeded (two legs each), not opening rows;
    // a real go-live import writes one 'opening' movement per variant so the ledger sums to the balance.
    if (!(await tx.select({ id: stockMovements.id }).from(stockMovements).limit(1)).length) {
      await tx.insert(stockMovements).values(data.transfers.flatMap((t) => [t.from, t.from === 'store' ? 'online' : 'store'].map((channel, leg) => ({
        at: new Date(t.date), variantId: t.variantId, channel: channel as Channel, qty: leg ? t.qty : -t.qty, kind: 'transfer' as const, refId: t.id, userId: t.userId,
      }))))
    }
    await seedSales(tx, data)
    await seedBackOffice(tx, data)
    // New rows continue after the demo numbering (p055, sup7, barcode 509…)
    await bumpTo(tx, 'supplier', Math.max(...data.suppliers.map((s) => num(s.id))))
    await bumpTo(tx, 'product', Math.max(...data.products.map((p) => num(p.id))))
    await bumpTo(tx, 'customer', Math.max(...data.customers.map((c) => num(c.id))))
    await bumpTo(tx, 'transfer', Math.max(...data.transfers.map((t) => num(t.id))))
    await bumpTo(tx, 'barcode', Math.max(...data.variants.map((v) => Number(v.barcode.slice(7, 12)))))
  })
}
