import { Hono } from 'hono'
import { z } from 'zod'
import { authenticate, type AppEnv } from '../../lib/auth'
import { v } from '../../lib/validate'
import { listActivity } from '../activity/service'
import { bootstrap } from './service'

export const bootstrapRoutes = new Hono<AppEnv>()
  .use(authenticate)
  .get('/', async (c) => c.json(await bootstrap(c.var.user)))

export const activityRoutes = new Hono<AppEnv>()
  .use(authenticate)
  .get('/', v('query', z.object({ limit: z.coerce.number().int().min(1).max(300).default(100) })), async (c) =>
    c.json(await listActivity(c.var.user, c.req.valid('query').limit)))
