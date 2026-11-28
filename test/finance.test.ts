import { beforeAll, describe, expect, it } from 'vitest'
import { seed } from '../src/db/seed'
import { profitAndLoss, tripCost } from '../src/shared/money'
import { buildSeed } from '../src/shared/seed'
import type { Expense, SalaryPayment, Trip } from '../src/shared/types'
import { call, json, login, OWNER } from './helpers'

const CASHIER = '9847033333' // u3, salary 18000, no finance
const INVESTOR = '9847066666' // u6: dashboard + investors, salary 0
const demo = buildSeed()
let owner: string
beforeAll(async () => {
  await seed()
  owner = (await login(OWNER)).token
})

type Pnl = ReturnType<typeof profitAndLoss>
const errorOf = async (res: Response) => (await json<{ error: { code: string; message: string } }>(res)).error
const pnlOf = async (from: Date, to: Date, token = owner) =>
  json<Pnl>(await call(`/reports/pnl?from=${from.toISOString()}&to=${to.toISOString()}`, { token }))
const expectSame = (got: Pnl, want: Pnl) => { for (const k of Object.keys(want) as (keyof Pnl)[]) expect(got[k], k).toBeCloseTo(want[k], 2) }

const now = new Date()
const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1)
const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1)
const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

describe('P&L report', () => {
  it('matches the frontend profitAndLoss on the demo data, for a month and for all time', async () => {
    expectSame(await pnlOf(lastMonth, thisMonth), profitAndLoss(demo, lastMonth, thisMonth))
    const all = [new Date('2020-01-01'), new Date('2100-01-01')] as const
    const want = profitAndLoss(demo, ...all)
    expectSame(await pnlOf(...all, (await login(INVESTOR)).token), want)
    expect(want.revenue).toBeGreaterThan(0)
    expect(want.trips).toBeGreaterThan(0)
  })

  it('counts a settled trip at its frozen total, not a recomputed one', () => {
    const t = demo.trips.find((x) => x.status === 'settled')!
    const frozen: Trip = { ...t, settled: { ...tripCost(t), total: 1 }, allowancePerDay: 999_999 }
    const range = [new Date('2020-01-01'), new Date('2100-01-01')] as const
    expect(profitAndLoss({ sales: [], expenses: [], salaryPayments: [], trips: [frozen] }, ...range).trips).toBe(1)
  })

  it('validates the range and access', async () => {
    expect((await errorOf(await call(`/reports/pnl?from=${thisMonth.toISOString()}&to=${lastMonth.toISOString()}`, { token: owner }))).code).toBe('invalid_input')
    expect((await call('/reports/pnl?from=x&to=y', { token: owner })).status).toBe(400)
    expect((await call(`/reports/pnl?from=${lastMonth.toISOString()}&to=${thisMonth.toISOString()}`, { token: (await login(CASHIER)).token })).status).toBe(403) // dashboard alone doesn't show profit
    expect((await call(`/reports/pnl?from=${lastMonth.toISOString()}&to=${thisMonth.toISOString()}`, { token: (await login('9847055555')).token })).status).toBe(403) // purchase: no P&L
  })
})

describe('expenses', () => {
  it('records an expense (blank note → category) and it lands in the P&L', async () => {
    const before = await pnlOf(thisMonth, nextMonth)
    const res = await call('/expenses', { body: { category: 'Packaging', amount: 1234.5, note: ' ' }, token: owner })
    expect(res.status).toBe(201)
    expect(await json(res)).toMatchObject({ id: `e${demo.expenses.length + 1}`, category: 'Packaging', note: 'Packaging', amount: 1234.5 })
    const after = await pnlOf(thisMonth, nextMonth)
    expect(after.expenses).toBeCloseTo(before.expenses + 1234.5, 2)
    expect(after.netProfit).toBeCloseTo(before.netProfit - 1234.5, 2)
    expect(await json<Expense[]>(await call('/expenses', { token: owner }))).toHaveLength(demo.expenses.length + 1)
  })

  it('refuses bad input, future dates and non-finance users', async () => {
    for (const body of [{ category: 'Snacks', amount: 10 }, { category: 'Misc', amount: 0 }, { category: 'Misc' }]) {
      expect((await call('/expenses', { body, token: owner })).status).toBe(400)
    }
    const future = await call('/expenses', { body: { category: 'Misc', amount: 10, date: new Date(Date.now() + 3 * 86_400_000).toISOString() }, token: owner })
    expect((await errorOf(future)).code).toBe('future_date')
    expect((await call('/expenses', { body: { category: 'Misc', amount: 10 }, token: (await login(CASHIER)).token })).status).toBe(403)
  })
})

describe('salaries', () => {
  it('pays the salary on record once per person per month', async () => {
    const month = monthKey(now)
    const paidAlready = demo.salaryPayments.some((p) => p.userId === 'u3' && p.month === month)
    expect(paidAlready).toBe(false) // the demo leaves the current month unpaid
    const res = await call('/salaries', { body: { userId: 'u3', month, amount: 1 }, token: owner }) // a sent amount is ignored
    expect(res.status).toBe(201)
    expect(await json(res)).toMatchObject({ userId: 'u3', month, amount: 18000 })
    const again = await call('/salaries', { body: { userId: 'u3', month }, token: owner })
    expect(await errorOf(again)).toEqual({ code: 'conflict', message: `Sneha Nair's ${month} salary is already paid` })
    expect(await json<SalaryPayment[]>(await call('/salaries', { token: owner }))).toHaveLength(demo.salaryPayments.length + 1)
  })

  it('labels demo payments with the month they were for (paid on the 1st of the next month)', () => {
    for (const p of demo.salaryPayments) {
      const paid = new Date(p.paidOn)
      expect(monthKey(new Date(paid.getFullYear(), paid.getMonth() - 1, 1))).toBe(p.month)
    }
  })

  it('refuses future months, people without a salary and bad months', async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ userId: 'u3', month: monthKey(nextMonth) }, 'future_month'],
      [{ userId: 'u6', month: monthKey(lastMonth) }, 'no_salary'], // investor
      [{ userId: 'nope', month: monthKey(lastMonth) }, 'no_salary'],
      [{ userId: 'u3', month: '2026-13' }, 'invalid_input'],
    ]
    for (const [body, code] of cases) expect((await errorOf(await call('/salaries', { body, token: owner }))).code).toBe(code)
    expect((await call('/salaries', { body: { userId: 'u4', month: monthKey(lastMonth) }, token: (await login(CASHIER)).token })).status).toBe(403)
  })
})
