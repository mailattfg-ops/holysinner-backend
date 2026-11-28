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
  JOBS_SECRET: blankIsUnset(z.string().min(16).default('dev-only-jobs-secret')),
  CORS_ORIGIN: blankIsUnset(z.string().default('http://localhost:5173')), // comma-separated
})

export const env = schema.parse(process.env)

if (env.NODE_ENV === 'production' && (!env.DATABASE_URL || env.JWT_SECRET === DEV_JWT)) {
  throw new Error('Production needs DATABASE_URL and a real JWT_SECRET')
}
