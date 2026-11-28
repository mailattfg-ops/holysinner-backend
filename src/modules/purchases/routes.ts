import { Hono } from 'hono'
import { READ } from '../../lib/access'
import { authenticate, requireModule, type AppEnv } from '../../lib/auth'
import { v } from '../../lib/validate'
import { purchaseInput, supplierPaymentInput } from '../../shared/schemas'
import { addPurchase, listPurchases, paySupplier } from './service'

// Reads also feed finance and trips (bills linked to a buying trip). The dashboard only needs total dues: /bootstrap (step 13) sends that, not the bills.
export const purchaseRoutes = new Hono<AppEnv>()
  .use(authenticate)
  .get('/', requireModule(...READ.purchases), async (c) => c.json(await listPurchases()))
  .post('/', requireModule('purchases'), v('json', purchaseInput), async (c) => c.json(await addPurchase(c.var.user, c.req.valid('json')), 201))
  .post('/payments', requireModule('purchases'), v('json', supplierPaymentInput), async (c) => c.json(await paySupplier(c.var.user, c.req.valid('json')), 201))
