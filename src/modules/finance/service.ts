import { and, asc, eq, gte, lt } from 'drizzle-orm'
import type { z } from 'zod'
import { db } from '../../db'
import { expenses, products, returns, salaryPayments, users } from '../../db/schema'
import { audit } from '../../lib/audit'
import type { UserRow } from '../../lib/auth'
import { reserve } from '../../lib/counters'
import { AppError, conflict } from '../../lib/errors'
import { rupees } from '../../lib/format'
import { istMonth, notInFuture } from '../../lib/ist'
import { gstReport } from '../../shared/billing'
import { profitAndLoss, type PnlInput } from '../../shared/money'
import type { expenseInput, salaryInput } from '../../shared/schemas'
import { listSales, salesByIds } from '../sales/service'
import { listTrips } from '../trips/service'


type ExpenseRow = typeof expenses.$inferSelect
type SalaryRow = typeof salaryPayments.$inferSelect
const toExpense = ({ userId: _u, ...e }: ExpenseRow) => ({ ...e, date: e.date.toISOString() })
const toSalary = (p: SalaryRow) => ({ ...p, paidOn: p.paidOn.toISOString() })

export const listExpenses = async () => (await db.select().from(expenses).orderBy(asc(expenses.date), asc(expenses.id))).map(toExpense)
export const listSalaries = async () => (await db.select().from(salaryPayments).orderBy(asc(salaryPayments.paidOn), asc(salaryPayments.id))).map(toSalary)

export async function addExpense(by: UserRow, input: z.infer<typeof expenseInput>) {
  const date = input.date ?? new Date()
  notInFuture(date, 'expense')
  return db.transaction(async (tx) => {
    const [e] = await tx.insert(expenses).values({ ...input, id: `e${await reserve(tx, 'expense')}`, date, note: input.note || input.category, userId: by.id }).returning()
    await audit(tx, { userId: by.id, action: 'Expense added', detail: `${e!.category} · ${rupees(e!.amount)}`, entity: 'expense', entityId: e!.id })
    return toExpense(e!)
  })
}

// Pays the salary on record for that month, once. A month that hasn't started can't be paid.
export async function paySalary(by: UserRow, { userId, month }: z.infer<typeof salaryInput>) {
  const [u] = await db.select().from(users).where(eq(users.id, userId))
  if (!u?.active || !u.salary) throw new AppError('no_salary', 'Pick a staff member with a salary')
  if (month > istMonth(new Date())) throw new AppError('future_month', `${month} hasn't started yet`)
  return db.transaction(async (tx) => {
    const [dup] = await tx.select({ id: salaryPayments.id }).from(salaryPayments).where(and(eq(salaryPayments.userId, userId), eq(salaryPayments.month, month)))
    if (dup) throw conflict(`${u.name}'s ${month} salary is already paid`)
    const [p] = await tx.insert(salaryPayments).values({ id: `sp${await reserve(tx, 'salary')}`, userId, month, amount: u.salary }).returning()
    await audit(tx, { userId: by.id, action: 'Salary paid', detail: `${u.name} · ${month}`, entity: 'user', entityId: userId })
    return toSalary(p!)
  })
}

// Everything profitAndLoss needs for [from, to). Only sales are filtered in SQL; expenses, salaries and trips
// are small and profitAndLoss picks the range itself (so one load can serve several months).
export async function pnlData(from: Date, to: Date): Promise<PnlInput> {
  const [sales, expenseList, salaries, tripList] = await Promise.all([listSales({ from, to }), listExpenses(), listSalaries(), listTrips()])
  return { sales, expenses: expenseList, salaryPayments: salaries, trips: tripList }
}

// The same profitAndLoss the Finance and Dashboard screens run, over the database's rows.
export const pnl = async (from: Date, to: Date) => profitAndLoss(await pnlData(from, to), from, to)

// GSTR-1 for [from, to): the invoices dated in it, less the returns dated in it (each against the bill it came from).
// Same shared gstReport as the Finance screen and its CSV downloads.
export async function gstForPeriod(from: Date, to: Date) {
  const [periodSales, periodReturns, hsnRows] = await Promise.all([
    listSales({ from, to }),
    db.select().from(returns).where(and(gte(returns.date, from), lt(returns.date, to))),
    db.select({ id: products.id, hsn: products.hsn }).from(products),
  ])
  const bills = new Map((await salesByIds([...new Set(periodReturns.map((r) => r.saleId))])).map((s) => [s.id, s]))
  const hsn = new Map(hsnRows.map((p) => [p.id, p.hsn]))
  const returned = periodReturns.map((r) => ({
    entry: { ...r, date: r.date.toISOString(), creditNoteNo: r.creditNoteNo ?? undefined },
    sale: bills.get(r.saleId)!, // the FK guarantees the bill exists
  }))
  return gstReport(periodSales, returned, (productId) => hsn.get(productId) ?? '')
}
