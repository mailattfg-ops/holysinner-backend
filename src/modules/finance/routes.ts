import { Hono } from 'hono'
import { READ } from '../../lib/access'
import { authenticate, requireModule, type AppEnv } from '../../lib/auth'
import { v } from '../../lib/validate'
import { expenseInput, pnlQuery, salaryInput } from '../../shared/schemas'
import { addExpense, gstForPeriod, listExpenses, listSalaries, paySalary, pnl } from './service'

// Profit, expenses and salaries are owner-level info: the dashboard shows profit only to finance/investor users too.
const readers = requireModule(...READ.money)
const finance = requireModule('finance')

export const expenseRoutes = new Hono<AppEnv>()
  .use(authenticate)
  .get('/', readers, async (c) => c.json(await listExpenses()))
  .post('/', finance, v('json', expenseInput), async (c) => c.json(await addExpense(c.var.user, c.req.valid('json')), 201))

export const salaryRoutes = new Hono<AppEnv>()
  .use(authenticate)
  .get('/', readers, async (c) => c.json(await listSalaries()))
  .post('/', finance, v('json', salaryInput), async (c) => c.json(await paySalary(c.var.user, c.req.valid('json')), 201))

export const reportRoutes = new Hono<AppEnv>()
  .use(authenticate)
  .get('/pnl', readers, v('query', pnlQuery), async (c) => {
    const { from, to } = c.req.valid('query')
    return c.json(await pnl(from, to))
  })
  // GSTR-1 tables for the accountant. Output tax only, no cost or profit, so analytics users may read it too.
  .get('/gst', requireModule(...READ.gst), v('query', pnlQuery), async (c) => {
    const { from, to } = c.req.valid('query')
    return c.json(await gstForPeriod(from, to))
  })
