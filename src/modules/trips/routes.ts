import { Hono } from 'hono'
import { z } from 'zod'
import { READ } from '../../lib/access'
import { authenticate, requireModule, type AppEnv } from '../../lib/auth'
import { v } from '../../lib/validate'
import { tripCreate, tripExpense } from '../../shared/schemas'
import { addTripExpense, listTrips, planTrip, removeTripExpense, settleTrip, startTrip } from './service'

const idParam = v('param', z.object({ id: z.string().min(1) }))
const trip = requireModule('trips')

// Reads also feed the P&L (dashboard, finance, investors) and the trip picker on purchase entry.
export const tripRoutes = new Hono<AppEnv>()
  .use(authenticate)
  .get('/', requireModule(...READ.trips), async (c) => c.json(await listTrips()))
  .post('/', trip, v('json', tripCreate), async (c) => c.json(await planTrip(c.var.user, c.req.valid('json')), 201))
  .post('/:id/start', trip, idParam, async (c) => c.json(await startTrip(c.var.user, c.req.valid('param').id)))
  .post('/:id/expenses', trip, idParam, v('json', tripExpense), async (c) => c.json(await addTripExpense(c.var.user, c.req.valid('param').id, c.req.valid('json'))))
  .delete('/:id/expenses/:index', trip, v('param', z.object({ id: z.string().min(1), index: z.coerce.number().int().min(0) })), async (c) =>
    c.json(await removeTripExpense(c.var.user, c.req.valid('param').id, c.req.valid('param').index)))
  .post('/:id/settle', trip, idParam, async (c) => c.json(await settleTrip(c.var.user, c.req.valid('param').id)))
