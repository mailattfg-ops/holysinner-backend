import { Hono } from 'hono'
import { z } from 'zod'
import { READ } from '../../lib/access'
import { authenticate, requireModule, type AppEnv } from '../../lib/auth'
import { v } from '../../lib/validate'
import { customerInput, customerPatch, customerSearch } from '../../shared/schemas'
import { addCustomer, listCustomers, updateCustomer } from './service'

// Reads: every module that shows customer names/phones. Cashiers add customers at the till (pos); edits need 'customers'.
export const customerRoutes = new Hono<AppEnv>()
  .use(authenticate)
  .get('/', requireModule(...READ.customers), v('query', customerSearch), async (c) =>
    c.json(await listCustomers(c.req.valid('query').q)))
  .post('/', requireModule('customers', 'pos'), v('json', customerInput), async (c) => c.json(await addCustomer(c.var.user, c.req.valid('json')), 201))
  .patch('/:id', requireModule('customers'), v('param', z.object({ id: z.string().min(1) })), v('json', customerPatch), async (c) =>
    c.json(await updateCustomer(c.var.user, c.req.valid('param').id, c.req.valid('json'))))
