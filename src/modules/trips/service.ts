import { asc, eq } from 'drizzle-orm'
import type { z } from 'zod'
import { db } from '../../db'
import { trips, users } from '../../db/schema'
import { audit } from '../../lib/audit'
import type { UserRow } from '../../lib/auth'
import { reserve } from '../../lib/counters'
import { AppError, conflict, notFound } from '../../lib/errors'
import { tripCost } from '../../shared/money'
import type { tripCreate, tripExpense } from '../../shared/schemas'

type TripRow = typeof trips.$inferSelect
interface Change { patch: Partial<TripRow>; action: string; detail: string }

const rupees = (n: number) => `₹${n.toLocaleString('en-IN')}`
const toTrip = (t: TripRow) => ({ ...t, startDate: t.startDate.toISOString(), endDate: t.endDate.toISOString(), settledAt: t.settledAt?.toISOString() ?? null })

export const listTrips = async () => (await db.select().from(trips).orderBy(asc(trips.startDate), asc(trips.id))).map(toTrip)

export async function planTrip(by: UserRow, input: z.infer<typeof tripCreate>) {
  const [staff] = await db.select({ active: users.active }).from(users).where(eq(users.id, input.staffId))
  if (!staff?.active) throw new AppError('unknown_staff', 'Pick a staff member from the list')
  return db.transaction(async (tx) => {
    const [t] = await tx.insert(trips).values({ ...input, id: `t${await reserve(tx, 'trip')}` }).returning()
    await audit(tx, { userId: by.id, action: 'Trip planned', detail: `${t!.city}, ${t!.state}`, entity: 'trip', entityId: t!.id })
    return toTrip(t!)
  })
}

// Every change locks the trip and refuses once it's settled: settled totals are what was actually paid out.
function changeTrip(by: UserRow, id: string, change: (t: TripRow) => Change) {
  return db.transaction(async (tx) => {
    const [t] = await tx.select().from(trips).where(eq(trips.id, id)).for('update')
    if (!t) throw notFound('Trip')
    if (t.status === 'settled') throw conflict(`The ${t.city} trip is already settled`)
    const { patch, action, detail } = change(t)
    const [row] = await tx.update(trips).set(patch).where(eq(trips.id, id)).returning()
    await audit(tx, { userId: by.id, action, detail, entity: 'trip', entityId: id })
    return toTrip(row!)
  })
}

export const startTrip = (by: UserRow, id: string) => changeTrip(by, id, (t) => {
  if (t.status !== 'planned') throw new AppError('invalid_status', `The ${t.city} trip has already started`)
  return { patch: { status: 'ongoing' }, action: 'Trip started', detail: `${t.city}, ${t.state}` }
})

export const addTripExpense = (by: UserRow, id: string, e: z.infer<typeof tripExpense>) => changeTrip(by, id, (t) =>
  ({ patch: { expenses: [...t.expenses, e] }, action: 'Trip expense', detail: `${t.city} · ${e.label} ${rupees(e.amount)}` }))

// Expense lines are a draft until settlement, so a mistyped one can be taken out.
export const removeTripExpense = (by: UserRow, id: string, index: number) => changeTrip(by, id, (t) => {
  const e = t.expenses[index]
  if (!e) throw notFound('Expense')
  return { patch: { expenses: t.expenses.toSpliced(index, 1) }, action: 'Trip expense removed', detail: `${t.city} · ${e.label} ${rupees(e.amount)}` }
})

export const settleTrip = (by: UserRow, id: string) => changeTrip(by, id, (t) => {
  if (t.status !== 'ongoing') throw new AppError('invalid_status', `Start the ${t.city} trip before settling it`)
  const settled = tripCost(toTrip(t))
  const detail = `${t.city} · ${settled.balance >= 0 ? `paid staff ${rupees(settled.balance)}` : `staff returned ${rupees(-settled.balance)}`}`
  return { patch: { status: 'settled', settled, settledAt: new Date() }, action: 'Trip settled', detail }
})
