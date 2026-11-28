// Copied from frontend/src/lib/store.ts (pure part). Keep identical; see progress.md "shared code".
import type { Expense, SalaryPayment, Sale, Trip } from './types'

export function saleNet(s: Sale) {
  const returnedRatio = s.items.reduce((t, i) => t + (i.returnedQty ?? 0) * i.price, 0) / (s.subtotal || 1)
  const revenue = (s.total + s.pointsRedeemed) * (1 - returnedRatio) // incl GST, after discounts
  const tax = s.taxTotal * (1 - returnedRatio)
  const cogs = s.items.reduce((t, i) => t + (i.qty - (i.returnedQty ?? 0)) * i.cost, 0)
  return { revenue, netRevenue: revenue - tax, tax, cogs, grossProfit: revenue - tax - cogs }
}

export function tripCost(t: Trip) {
  const days = Math.max(1, Math.round((new Date(t.endDate).getTime() - new Date(t.startDate).getTime()) / 86400000))
  const allowance = days * t.allowancePerDay
  const expenses = t.expenses.reduce((s, e) => s + e.amount, 0)
  return { days, allowance, expenses, payment: t.tripPayment, total: allowance + expenses + t.tripPayment, balance: allowance + expenses + t.tripPayment - t.advance }
}

export interface PnlInput { sales: Sale[]; expenses: Expense[]; salaryPayments: SalaryPayment[]; trips: Trip[] }

// P&L for a date range [from, to)
export function profitAndLoss(s: PnlInput, from: Date, to: Date) {
  const inRange = (d: string) => { const t = new Date(d).getTime(); return t >= from.getTime() && t < to.getTime() }
  let revenue = 0, netRevenue = 0, tax = 0, cogs = 0
  for (const x of s.sales) if (inRange(x.date)) { const n = saleNet(x); revenue += n.revenue; netRevenue += n.netRevenue; tax += n.tax; cogs += n.cogs }
  const expenses = s.expenses.filter((e) => inRange(e.date)).reduce((t, e) => t + e.amount, 0)
  const salaries = s.salaryPayments.filter((p) => inRange(p.paidOn)).reduce((t, p) => t + p.amount, 0)
  const trips = s.trips.filter((t) => t.status !== 'planned' && inRange(t.startDate)).reduce((t, x) => t + (x.settled?.total ?? tripCost(x).total), 0)
  const grossProfit = netRevenue - cogs
  return { revenue, netRevenue, tax, cogs, grossProfit, expenses, salaries, trips, netProfit: grossProfit - expenses - salaries - trips }
}
