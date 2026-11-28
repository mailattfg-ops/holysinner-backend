# Holysinner ERP — Tech Stack, Tools & Integrations

Policy: **use free and open-source tools first.** Pay only when a free tier blocks the business, and record why in `progress.md`.
Status: ✅ in use now · 🔜 planned (phase in brackets) · ⚪ optional, only if the business needs it.

## 1. Frontend (`frontend/`, repo `holysinner-frontend`)

| Area | Tool | License | Status |
|---|---|---|---|
| Language | TypeScript ~6.0 (strict) | Apache-2.0 | ✅ |
| UI framework | React 19 | MIT | ✅ |
| Build / dev server | Vite 8 + `@vitejs/plugin-react` | MIT | ✅ |
| Styling | Tailwind CSS v4, `tw-animate-css` | MIT | ✅ |
| Components | shadcn/ui on Radix, `class-variance-authority`, `cmdk` | MIT | ✅ |
| Icons / font | `lucide-react`, Geist Variable | ISC / OFL | ✅ |
| Routing | `react-router-dom` 7 | MIT | ✅ |
| State | Zustand 5 (localStorage now → hydrated from the API in Phase 4) | MIT | ✅ |
| Charts / animation | Recharts 3, `motion` | MIT | ✅ |
| Dates / toasts / theme | `date-fns`, `react-day-picker`, `sonner`, `next-themes` | MIT | ✅ |
| Barcodes | `jsbarcode` + browser print | MIT | ✅ |
| Lint | `oxlint` | MIT | ✅ |
| API client | `hono/client` (typed RPC, no codegen) | MIT | 🔜 (4) |
| Camera scan | Native `BarcodeDetector`, with `@zxing/browser` as the fallback | — / Apache-2.0 | 🔜 (7) |
| Receipt printing | ESC/POS over WebUSB (`@point-of-sale/receipt-printer-encoder`). Browser print until then | MIT | 🔜 (7) |
| Hosting | **Vercel** (static SPA) | free tier | ✅ |

## 2. Backend (`backend/`, repo `holysinner-backend`)

| Area | Tool | License | Status |
|---|---|---|---|
| Runtime | Node.js 22 on **Vercel Functions** (Node runtime, region `bom1` Mumbai) | MIT | ✅ local / 🔜 deploy |
| Language | TypeScript (strict, ESM) | Apache-2.0 | 🔜 (1) |
| HTTP framework | Hono (`hono/vercel` handler in prod, `@hono/node-server` for local dev) | MIT | 🔜 (1) |
| Validation | Zod + `@hono/zod-validator`. Env vars are also validated with Zod | MIT | 🔜 (1) |
| Database | **Supabase Postgres** (region `ap-south-1` Mumbai) | Apache-2.0 / PostgreSQL | 🔜 (1) |
| DB connection | `postgres` (postgres.js) through the Supabase **Supavisor pooler** (transaction mode, port 6543, `prepare: false`), which serverless functions need | Unlicense | 🔜 (1) |
| ORM / migrations | Drizzle ORM + `drizzle-kit`, the only migration tool. Supabase extensions are enabled in a custom migration | Apache-2.0 | 🔜 (1) |
| Auth | `hono/jwt` (15-min access token) + httpOnly refresh cookie, `@node-rs/argon2` for PIN hashing | MIT | 🔜 (1) |
| Login lockout | Postgres columns `failed_logins` and `locked_until` on `users`. An in-memory limiter doesn't work on serverless and no extra service is needed | — | 🔜 (1) |
| Background jobs | **Supabase Queues (`pgmq`)**: durable queue inside Postgres with retries through a visibility timeout | PostgreSQL | 🔜 (6) |
| Scheduler | **`pg_cron` + `pg_net`** (Supabase extensions): every few minutes, POST `/api/jobs/run` with a secret header; the function drains the queue in small batches | PostgreSQL | 🔜 (6) |
| Logging | `pino` JSON to stdout (Vercel runtime logs, short retention) + an `app_logs` table in Supabase for warnings, errors and job failures (pruned after 30 days by `pg_cron`) | MIT | 🔜 (1) |
| Business audit | `audit_log` table (never pruned) | — | 🔜 (1) |
| Secret encryption | `node:crypto` AES-256-GCM (Shopify token at rest) | — | 🔜 (6) |
| Dev runner / build | `tsx watch` (dev), `tsc` (build) | MIT | 🔜 (1) |
| Local DB | **PGlite** (`@electric-sql/pglite`): real Postgres in WASM, used when `DATABASE_URL` is unset. Data lives in `.pglite/`; no Docker needed. It lacks `pgmq`/`pg_cron`, so job features are tested against Supabase | Apache-2.0 | ✅ |
| Tests | Vitest against in-memory PGlite (a fresh DB per test file) | MIT | ✅ |
| Lint | `oxlint` | MIT | 🔜 (1) |

## 3. Supabase features we use (and don't)

| Feature | Use | Status |
|---|---|---|
| Postgres database | The main data store | 🔜 (1) |
| Queues (`pgmq`), Cron (`pg_cron`), `pg_net` | Background jobs and schedules (§2) | 🔜 (6) |
| Row Level Security | **RLS is enabled on every table with no policies.** Only the backend (connected as the DB owner through the pooler) can read or write, so the public `anon` key can't reach any data. The frontend never uses `supabase-js` | 🔜 (1) |
| Storage | Product photos with signed upload URLs (replaces Cloudflare R2) | ⚪ |
| Realtime | Live stock updates across tills | ⚪ |
| Supabase Auth | **Not used.** Staff log in with phone + PIN; Supabase phone OTP would need a paid SMS provider | — |
| Edge Functions | **Not used.** All server code lives in one Hono app on Vercel | — |

## 4. Shared code

| What | Where | Status |
|---|---|---|
| `computeBill`, `gstRateFor`, `saleNet`, `profitAndLoss`, `tripCost`, `splitProfit`, `ean13`, domain types, Zod input schemas | `@holysinner/shared` | 🔜 (0). **Open decision**, see progress.md |

## 5. External APIs & SDKs

| Service | Used for | How | Cost | Status |
|---|---|---|---|---|
| **Shopify Admin GraphQL API** | Pulling online orders, pushing online stock (`inventorySetQuantities`), mapping variants | `@shopify/shopify-api` (MIT) | Included with Shopify | 🔜 (6) |
| **Shopify Webhooks** | `orders/create`, `orders/cancelled`, `refunds/create`, `app/uninstalled` | Verify HMAC, enqueue to `pgmq`, reply 200 immediately; the job does the work | Free | 🔜 (6) |
| **WhatsApp Business Cloud API** (Meta) | Bill receipts, birthday and offer campaigns, using approved templates | Plain `fetch` to `graph.facebook.com`, queued in `pgmq`, delivery-status webhook | Meta charges per conversation; free `wa.me` links until then ✅ | 🔜 (7) |
| **Razorpay** | Dynamic UPI QR at POS with automatic payment confirmation | `razorpay` SDK + webhook | Per-transaction fee | ⚪ |
| **MSG91** (or another Indian SMS gateway) | OTP for PIN reset, SMS receipts | REST API, DLT templates (required in India) | Per SMS | ⚪ |
| **GST provider** (ClearTax / Masters India) | Checking GSTINs; e-invoicing only above ₹5 Cr turnover | REST API | Paid | ⚪ |

## 6. DevOps & monitoring (all free)

| Area | Tool | Status |
|---|---|---|
| Source control | GitHub: `mailattfg-ops/holysinner-frontend`, `mailattfg-ops/holysinner-backend` | ✅ |
| CI | GitHub Actions: lint → typecheck → test → build. Migrations run with `drizzle-kit migrate` on merge to `main` | 🔜 (1) |
| Deploys | Vercel Git integration for both repos (a preview for every PR, production from `main`) | ✅ frontend / 🔜 (1) backend |
| Backups | **Nightly `pg_dump` in GitHub Actions**, kept 30 days as an encrypted artifact. The free Supabase plan has no point-in-time restore, so we don't rely on its backups | 🔜 (4) |
| Keep-alive | Supabase pauses free projects after 7 days without activity. A GitHub Actions workflow that runs every 6 days, `backend/.github/workflows/keep-alive.yml` pings `/api/health`, which runs `select 1`. It's skipped until the `HEALTH_URL` repo secret is set | ✅ workflow / 🔜 (1) endpoint |
| Error tracking | `app_logs` table (free, open source). Sentry's free plan (MIT SDKs) is an option if alerts are needed | ✅ plan / ⚪ Sentry |
| Secrets | Vercel env vars. Only `.env.example` is committed | 🔜 (1) |

## 7. Hardware (shop counter)

| Device | Connects via | Status |
|---|---|---|
| USB barcode scanner | Keyboard (HID); the POS scan bar already handles it | ✅ |
| 80 mm thermal receipt printer (ESC/POS) | Browser print now, WebUSB direct later | ✅ / 🔜 (7) |
| Barcode label printer (TSC/Zebra) | Browser print to the label size | ✅ |
| Phone camera | `BarcodeDetector` | 🔜 (7) |

## 8. Free-tier limits to watch

| Limit | Free tier | Our expected use |
|---|---|---|
| Supabase DB size | 500 MB | About 1–2 KB per bill with its items. 100 bills a day is roughly 70 MB a year |
| Supabase egress | 5 GB / month | `/bootstrap` must stay lean; move to paginated or aggregate endpoints if this grows |
| Supabase pausing | After 7 idle days | Keep-alive ping every 6 days (§6) |
| Vercel function duration | Short on Hobby | Jobs process small batches per run; no long work inside a request |
| GitHub Actions | 2,000 min / month (private repos) | CI + nightly backup is well under that |
| ⚠️ **Vercel Hobby terms** | **Personal, non-commercial use only** | **Decision (2026-11-26): staying on Hobby.** If Vercel flags the account, move to Vercel Pro ($20/month per member) or to Cloudflare Workers (free, commercial use allowed; Hono only needs a different entry file) |

## Not using (and why)
Redis and BullMQ (`pgmq` covers jobs), pg-boss (needs an always-on worker, which Vercel doesn't run), Railway/Render (Vercel was chosen), Neon (Supabase was chosen), Supabase Auth (phone + PIN), Edge Functions (one Hono app), GraphQL server, microservices, Prisma.
