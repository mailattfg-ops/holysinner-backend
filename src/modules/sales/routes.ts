import { Hono } from 'hono'
import { READ, salesFor } from '../../lib/access'
import { authenticate, requireModule, type AppEnv } from '../../lib/auth'
import { v } from '../../lib/validate'
import { checkoutInput } from '../../shared/schemas'
import { checkout, listCreditNotes, listSales } from './service'

// Sales history feeds the dashboard, analytics, returns, customers and investors screens.
export const saleRoutes = new Hono<AppEnv>()
  .use(authenticate)
  .get('/', requireModule(...READ.sales), async (c) => c.json(salesFor(c.var.user, await listSales())))
  .post('/checkout', requireModule('pos'), v('json', checkoutInput), async (c) => {
    const done = await checkout(c.var.user, c.req.valid('json'))
    return c.json({ ...done, sale: salesFor(c.var.user, [done.sale])[0] }, 201)
  })

export const creditNoteRoutes = new Hono<AppEnv>()
  .use(authenticate)
  .get('/', requireModule(...READ.creditNotes), async (c) => c.json(await listCreditNotes()))
