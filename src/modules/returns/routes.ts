import { Hono } from 'hono'
import { READ, salesFor } from '../../lib/access'
import { authenticate, requireModule, type AppEnv } from '../../lib/auth'
import { v } from '../../lib/validate'
import { returnInput } from '../../shared/schemas'
import { listReturns, processReturn } from './service'

// 'pos' too: the counter staff take returns and exchanges at the till.
export const returnRoutes = new Hono<AppEnv>()
  .use(authenticate)
  .get('/', requireModule(...READ.returns), async (c) => c.json(await listReturns()))
  .post('/', requireModule('returns', 'pos'), v('json', returnInput), async (c) => {
    const done = await processReturn(c.var.user, c.req.valid('json'))
    return c.json({ ...done, sale: salesFor(c.var.user, [done.sale])[0] }, 201)
  })
