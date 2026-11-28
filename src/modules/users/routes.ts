import { Hono } from 'hono'
import { authenticate, requireModule, requireOwner, type AppEnv } from '../../lib/auth'
import { v } from '../../lib/validate'
import { pinReset, userCreate, userPatch } from '../../shared/schemas'
import { createUser, listUsers, resetPin, updateUser } from './service'

export const userRoutes = new Hono<AppEnv>()
  .use(authenticate, requireModule('users'))
  .get('/', async (c) => c.json(await listUsers()))
  .post('/', requireOwner, v('json', userCreate), async (c) => c.json(await createUser(c.var.user, c.req.valid('json')), 201))
  .patch('/:id', requireOwner, v('json', userPatch), async (c) => c.json(await updateUser(c.var.user, c.req.param('id'), c.req.valid('json'))))
  .put('/:id/pin', requireOwner, v('json', pinReset), async (c) => {
    await resetPin(c.var.user, c.req.param('id'), c.req.valid('json').pin)
    return c.json({ ok: true })
  })
