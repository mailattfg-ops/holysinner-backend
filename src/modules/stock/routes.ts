import { Hono } from 'hono'
import { READ } from '../../lib/access'
import { authenticate, requireModule, type AppEnv } from '../../lib/auth'
import { v } from '../../lib/validate'
import { stockAdjust, stockTransfer } from '../../shared/schemas'
import { adjustStock, listTransfers, transferStock } from './service'

// Transfers are also made from the Online page ("push to online"), so the online module may move stock too.
export const stockRoutes = new Hono<AppEnv>()
  .use(authenticate)
  .post('/adjust', requireModule('inventory'), v('json', stockAdjust), async (c) => c.json(await adjustStock(c.var.user, c.req.valid('json'))))
  .post('/transfer', requireModule('inventory', 'online'), v('json', stockTransfer), async (c) => c.json(await transferStock(c.var.user, c.req.valid('json')), 201))
  .get('/transfers', requireModule(...READ.transfers), async (c) => c.json(await listTransfers()))
