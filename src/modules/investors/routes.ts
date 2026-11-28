import { Hono } from 'hono'
import { authenticate, requireModule, requireOwner, type AppEnv } from '../../lib/auth'
import { v } from '../../lib/validate'
import { investorSummaryQuery, sharesInput } from '../../shared/schemas'
import { investorSummary, setShares } from './service'

export const investorRoutes = new Hono<AppEnv>()
  .use(authenticate)
  .get('/summary', requireModule('investors'), v('query', investorSummaryQuery), async (c) =>
    c.json(await investorSummary(c.var.user, c.req.valid('query').months)))
  .put('/shares', requireOwner, v('json', sharesInput), async (c) => c.json(await setShares(c.var.user, c.req.valid('json'))))
