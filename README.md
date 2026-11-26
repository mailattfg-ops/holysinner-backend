# Holysinner ERP — Backend

Backend API and services for Holysinner ERP.

## Stack
- **Runtime:** Node.js 22 LTS, TypeScript (strict, ESM)
- **Framework:** Hono + `@hono/node-server`
- **Database:** PostgreSQL 16
- **ORM & Migrations:** Drizzle ORM + `drizzle-kit` (`postgres.js` driver)
- **Validation:** Zod + `@hono/zod-validator`
- **Authentication:** JWT (15-min access token) + httpOnly refresh cookie, Argon2 for PIN hashing
- **Background Jobs:** `pg-boss` (Postgres-based)
- **Deployment:** Railway / Docker

For complete architecture, domain rules, and implementation phases, see:
- [BACKEND_PLAN.md](./BACKEND_PLAN.md)
- [TECH_STACK.md](./TECH_STACK.md)
