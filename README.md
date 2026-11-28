# Holysinner ERP — Backend

Backend API and services for Holysinner ERP. Free and open-source tools first.

## Stack
- **Runtime:** Node.js 22 LTS, TypeScript (strict, ESM) on Vercel Functions (`bom1` Mumbai)
- **Framework:** Hono (`hono/vercel` in prod, `@hono/node-server` locally)
- **Database:** Supabase Postgres (`ap-south-1` Mumbai) via the Supavisor pooler
- **ORM & Migrations:** Drizzle ORM + `drizzle-kit` (`postgres.js` driver, `prepare: false`)
- **Validation:** Zod + `@hono/zod-validator`
- **Authentication:** phone + PIN, JWT (15-min access token) + httpOnly refresh cookie, Argon2 for PIN hashing
- **Background jobs:** Supabase Queues (`pgmq`) + `pg_cron` + `pg_net`
- **Logs:** `pino` + `app_logs` table
- **Local dev / tests:** PGlite (embedded Postgres, no setup) + Vitest

For the complete architecture, domain rules and implementation phases, see:
- [BACKEND_PLAN.md](./BACKEND_PLAN.md)
- [TECH_STACK.md](./TECH_STACK.md)
