import { PGlite } from '@electric-sql/pglite'
import { drizzle as drizzleLite } from 'drizzle-orm/pglite'
import { migrate as migrateLite } from 'drizzle-orm/pglite/migrator'
import { drizzle as drizzlePg } from 'drizzle-orm/postgres-js'
import { migrate as migratePg } from 'drizzle-orm/postgres-js/migrator'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'
import { env } from '../env'
import * as schema from './schema'

export type DB = PgDatabase<PgQueryResultHKT, typeof schema>
export type Tx = Parameters<Parameters<DB['transaction']>[0]>[0]

const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url))

// Supabase (pooler, transaction mode → no prepared statements) when DATABASE_URL is set; otherwise embedded PGlite.
// Tests get a fresh in-memory database per worker.
// max 10: through Supavisor's transaction pooler, a query that has to wait for a busy connection can hang forever
// (reproduced 2026-11-27; the session pooler doesn't). Client connections are cheap in transaction mode, so keep
// the pool well above what one instance runs at once (a P&L report runs 5 queries in parallel).
const POOL = 10
const pg = env.DATABASE_URL ? drizzlePg(postgres(env.DATABASE_URL, { prepare: false, max: POOL }), { schema, casing: 'snake_case' }) : undefined
const lite = pg ? undefined : drizzleLite(new PGlite(env.NODE_ENV === 'test' ? undefined : env.PGLITE_DIR), { schema, casing: 'snake_case' })

export const db = (pg ?? lite) as unknown as DB
export const dbKind = pg ? 'postgres' : 'pglite'

export const migrate = () => (pg ? migratePg(pg, { migrationsFolder }) : migrateLite(lite!, { migrationsFolder }))
