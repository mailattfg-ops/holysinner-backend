import { Hono } from 'hono'
import { z } from 'zod'
import { authenticate, requireModule, type AppEnv } from '../../lib/auth'
import { v } from '../../lib/validate'
import { offerCode, offerInput, settingsPatch } from '../../shared/schemas'
import { getSettings, listOffers, updateSettings, upsertOffer } from './service'

// Reads are open to every logged-in user: POS needs loyalty rules, receipt details and offers.
export const settingsRoutes = new Hono<AppEnv>()
  .use(authenticate)
  .get('/', async (c) => c.json(await getSettings()))
  .patch('/', requireModule('settings'), v('json', settingsPatch), async (c) => c.json(await updateSettings(c.var.user, c.req.valid('json'))))

export const offerRoutes = new Hono<AppEnv>()
  .use(authenticate)
  .get('/', async (c) => c.json(await listOffers()))
  // 'inventory' too: the dead-stock panel launches the CLEAR30 clearance offer.
  .put('/:code', requireModule('settings', 'inventory'), v('param', z.object({ code: offerCode })), v('json', offerInput), async (c) => {
    const { offer, created } = await upsertOffer(c.var.user, c.req.valid('param').code, c.req.valid('json'))
    return c.json(offer, created ? 201 : 200)
  })
