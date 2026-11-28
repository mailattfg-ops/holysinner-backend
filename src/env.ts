import { z } from 'zod'

const DEV_JWT = 'dev-only-jwt-secret-change-me-0123456789'
const blankIsUnset = <T extends z.ZodType>(s: T) => z.preprocess((v) => (v === '' ? undefined : v), s)

const schema = z.object({
  NODE_ENV: blankIsUnset(z.enum(['development', 'test', 'production']).default('development')),
  PORT: blankIsUnset(z.coerce.number().default(8787)),
  // unset → local PGlite (embedded Postgres) in PGLITE_DIR; set to the Supabase pooler URL to go live
  DATABASE_URL: blankIsUnset(z.string().optional()),
  PGLITE_DIR: blankIsUnset(z.string().default('.pglite')),
  JWT_SECRET: blankIsUnset(z.string().min(32).default(DEV_JWT)),
  CORS_ORIGIN: blankIsUnset(z.string().default('http://localhost:5173')), // comma-separated
})

export const env = schema.parse(process.env)

if (env.NODE_ENV === 'production' && !env.DATABASE_URL) throw new Error('Production needs DATABASE_URL')
// The dev key is public (it's in this file): anyone could forge an Owner token for a server that signs with it.
// So it's allowed only on the local embedded database, never on a real one, whatever NODE_ENV says.
if (env.DATABASE_URL && env.JWT_SECRET === DEV_JWT) {
  throw new Error('DATABASE_URL is set, so a real JWT_SECRET is required (32+ random characters, e.g. `openssl rand -hex 32`) in backend/.env')
}
