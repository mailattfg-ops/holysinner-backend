import { Hono } from 'hono'
import { z } from 'zod'
import { productsFor, READ } from '../../lib/access'
import { authenticate, requireModule, type AppEnv } from '../../lib/auth'
import { v } from '../../lib/validate'
import { productCreate, supplierInput } from '../../shared/schemas'
import { addProduct, addSupplier, findByBarcode, listProducts, listSuppliers, listVariants } from './service'

export const supplierRoutes = new Hono<AppEnv>()
  .use(authenticate)
  .get('/', requireModule(...READ.suppliers), async (c) => c.json(await listSuppliers()))
  .post('/', requireModule('purchases', 'inventory'), v('json', supplierInput), async (c) => c.json(await addSupplier(c.var.user, c.req.valid('json')), 201))

// Product and variant reads are open to every logged-in user (POS, returns, barcodes and analytics need them);
// unit cost is left out for those who don't work with costs.
export const productRoutes = new Hono<AppEnv>()
  .use(authenticate)
  .get('/', async (c) => c.json(productsFor(c.var.user, await listProducts())))
  .post('/', requireModule('inventory'), v('json', productCreate), async (c) => c.json(await addProduct(c.var.user, c.req.valid('json')), 201))

export const variantRoutes = new Hono<AppEnv>()
  .use(authenticate)
  .get('/', async (c) => c.json(await listVariants()))
  .get('/barcode/:code', v('param', z.object({ code: z.string().regex(/^\d{8,14}$/, 'Barcode must be 8–14 digits') })), async (c) => {
    const { variant, product } = await findByBarcode(c.req.valid('param').code)
    return c.json({ variant, product: productsFor(c.var.user, [product])[0] })
  })
