import { serve } from '@hono/node-server'
import { app } from './app'
import { dbKind, migrate } from './db'
import { env } from './env'
import { log } from './lib/log'

await migrate()
serve({ fetch: app.fetch, port: env.PORT }, (i) => log.info(`API on http://localhost:${i.port}/api (db: ${dbKind})`))
