import { sql } from 'drizzle-orm'
import { Hono, type ErrorHandler } from 'hono'
import { cors } from 'hono/cors'
import { HTTPException } from 'hono/http-exception'
import { secureHeaders } from 'hono/secure-headers'
import { db, dbKind } from './db'
import { env } from './env'
import { AppError } from './lib/errors'
import { logIssue } from './lib/log'
import { authRoutes } from './modules/auth/routes'
import { activityRoutes, bootstrapRoutes } from './modules/bootstrap/routes'
import { customerRoutes } from './modules/customers/routes'
import { expenseRoutes, reportRoutes, salaryRoutes } from './modules/finance/routes'
import { investorRoutes } from './modules/investors/routes'
import { purchaseRoutes } from './modules/purchases/routes'
import { returnRoutes } from './modules/returns/routes'
import { creditNoteRoutes, saleRoutes } from './modules/sales/routes'
import { productRoutes, supplierRoutes, variantRoutes } from './modules/catalog/routes'
import { offerRoutes, settingsRoutes } from './modules/settings/routes'
import { stockRoutes } from './modules/stock/routes'
import { tripRoutes } from './modules/trips/routes'
import { userRoutes } from './modules/users/routes'

export const app = new Hono().basePath('/api')

app.use(secureHeaders())
app.use(cors({ origin: env.CORS_ORIGIN.split(','), credentials: true }))

// Runs a real query so the keep-alive ping counts as Supabase activity.
app.get('/health', async (c) => {
  const t = Date.now()
  await db.execute(sql`select 1`)
  return c.json({ ok: true, db: dbKind, dbMs: Date.now() - t })
})

app.route('/auth', authRoutes)
app.route('/users', userRoutes)
app.route('/settings', settingsRoutes)
app.route('/offers', offerRoutes)
app.route('/suppliers', supplierRoutes)
app.route('/products', productRoutes)
app.route('/variants', variantRoutes)
app.route('/stock', stockRoutes)
app.route('/customers', customerRoutes)
app.route('/sales', saleRoutes)
app.route('/credit-notes', creditNoteRoutes)
app.route('/returns', returnRoutes)
app.route('/purchases', purchaseRoutes)
app.route('/trips', tripRoutes)
app.route('/expenses', expenseRoutes)
app.route('/salaries', salaryRoutes)
app.route('/reports', reportRoutes)
app.route('/investors', investorRoutes)
app.route('/bootstrap', bootstrapRoutes)
app.route('/activity', activityRoutes)

app.notFound((c) => c.json({ error: { code: 'not_found', message: 'Route not found' } }, 404))

export const onError: ErrorHandler = async (err, c) => {
  if (err instanceof AppError) return c.json({ error: { code: err.code, message: err.message } }, err.status)
  if (err instanceof HTTPException) return c.json({ error: { code: 'http', message: err.message } }, err.status)
  // A unique index lost a race that the service's own duplicate check couldn't see (two saves at the same instant).
  const pgCode = (err as { code?: string; cause?: { code?: string } }).cause?.code ?? (err as { code?: string }).code
  if (pgCode === '23505') return c.json({ error: { code: 'conflict', message: 'This was just saved by someone else. Refresh and check.' } }, 409)
  await logIssue('error', 'api', err.message, { path: c.req.path, method: c.req.method, stack: err.stack })
  return c.json({ error: { code: 'server_error', message: 'Something went wrong. Please try again.' } }, 500)
}
app.onError(onError)
