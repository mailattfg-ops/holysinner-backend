# Holysinner ERP — Tech Stack, Tools & Integrations

Status: ✅ in use now · 🔜 planned (phase in brackets) · ⚪ optional, only if the business needs it.

## 1. Frontend (`frontend/`, repo `holysinner-frontend`)

| Area | Tool | Status |
|---|---|---|
| Language | TypeScript ~6.0 (strict) | ✅ |
| UI framework | React 19 | ✅ |
| Build / dev server | Vite 8 + `@vitejs/plugin-react` | ✅ |
| Styling | Tailwind CSS v4 (`@tailwindcss/vite`), `tw-animate-css` | ✅ |
| Components | shadcn/ui on Radix (`radix-ui`), `class-variance-authority`, `cmdk` (command search) | ✅ |
| Icons / font | `lucide-react`, Geist Variable (`@fontsource-variable/geist`) | ✅ |
| Routing | `react-router-dom` 7 (lazy routes) | ✅ |
| State | Zustand 5 (localStorage `persist` now → hydrated from the API in Phase 4) | ✅ |
| Charts | Recharts 3 | ✅ |
| Animation | `motion` | ✅ |
| Dates | `date-fns` 4, `react-day-picker` | ✅ |
| Toasts / theme | `sonner`, `next-themes` | ✅ |
| Barcodes | `jsbarcode` (EAN-13 labels) + browser print | ✅ |
| Lint | `oxlint` | ✅ |
| API client | `hono/client` (typed RPC, no codegen) | 🔜 (4) |
| Camera scan | Native `BarcodeDetector` API, with `@zxing/browser` as the fallback | 🔜 (7) |
| Receipt printing | ESC/POS over WebUSB (`@point-of-sale/receipt-printer-encoder`). Browser print until then | 🔜 (7) |
| Hosting | Vercel (static SPA, `vercel.json` rewrites) | ✅ |

## 2. Backend (`backend/`, repo `holysinner-backend`)

| Area | Tool | Status |
|---|---|---|
| Runtime | Node.js 22 LTS, ESM | 🔜 (1) |
| Language | TypeScript (strict) | 🔜 (1) |
| HTTP framework | Hono + `@hono/node-server` | 🔜 (1) |
| Validation | Zod + `@hono/zod-validator`. Env vars are also validated with Zod | 🔜 (1) |
| Database | PostgreSQL 16 | 🔜 (1) |
| ORM / migrations | Drizzle ORM + `drizzle-kit`, `postgres` (postgres.js) driver | 🔜 (1) |
| Auth | `hono/jwt` (15-min access token) + httpOnly refresh cookie, `@node-rs/argon2` for PIN hashing | 🔜 (1) |
| Rate limiting | `hono-rate-limiter` (login and webhooks) | 🔜 (1) |
| Security headers / CORS | `hono/secure-headers`, `hono/cors` (Vercel domain only) | 🔜 (1) |
| Background jobs / cron | `pg-boss` (runs on Postgres, so no Redis) | 🔜 (6) |
| Logging | `pino` (JSON logs) | 🔜 (1) |
| Secret encryption | `node:crypto` AES-256-GCM (Shopify token at rest) | 🔜 (6) |
| Dev runner / build | `tsx watch` (dev), `tsc` (build) | 🔜 (1) |
| Tests | Vitest + Testcontainers (real Postgres in Docker) | 🔜 (1) |
| Lint | `oxlint` (same as the frontend) | 🔜 (1) |
| Hosting | Railway, Singapore region (closest to India; Railway has no Mumbai region), Docker image | 🔜 (4) |
| Managed DB | Neon Postgres, Singapore (`ap-southeast-1`), the same region as the API so database calls stay fast (daily backups + point-in-time restore) | 🔜 (4) |

## 3. Shared code

| What | Where | Status |
|---|---|---|
| `computeBill`, `gstRateFor`, `saleNet`, `profitAndLoss`, `tripCost`, `splitProfit`, `ean13`, domain types, Zod input schemas | `@holysinner/shared` package | 🔜 (0). **Open decision:** where it lives now that the frontend and backend are separate repos (see progress.md) |

## 4. External APIs & SDKs

| Service | Used for | How | Status |
|---|---|---|---|
| **Shopify Admin GraphQL API** | Pulling online orders, pushing online stock (`inventorySetQuantities`), mapping products and variants | `@shopify/shopify-api` SDK. Custom-app access token | 🔜 (6) |
| **Shopify Webhooks** | `orders/create`, `orders/cancelled`, `refunds/create`, `app/uninstalled` | HMAC-verified POST to `/api/webhooks/shopify/*`, idempotent on order ID | 🔜 (6) |
| **WhatsApp Business Cloud API** (Meta Graph API) | Bill receipts, birthday and offer campaigns, using approved templates | Plain `fetch` to `graph.facebook.com` (no SDK needed), queued through pg-boss, delivery-status webhook | 🔜 (7). `wa.me` links until then ✅ |
| **Razorpay** | Dynamic UPI QR at POS with automatic payment confirmation (today the cashier marks UPI paid by hand) | `razorpay` Node SDK + payment webhook | ⚪ |
| **MSG91** (or another Indian SMS gateway) | OTP for PIN reset, SMS receipts for customers without WhatsApp | REST API, DLT-registered templates (required in India) | ⚪ |
| **GST e-invoice / GSTIN lookup** (a GSP such as ClearTax or Masters India) | Checking supplier GSTINs; e-invoicing only becomes mandatory if turnover passes ₹5 Cr | REST API | ⚪ |
| **Cloudflare R2** | Product photos (the demo uses colour swatches) | S3-compatible API with `@aws-sdk/client-s3` and pre-signed uploads | ⚪ |

## 5. DevOps & monitoring

| Area | Tool | Status |
|---|---|---|
| Source control | GitHub: `mailattfg-ops/holysinner-frontend`, `mailattfg-ops/holysinner-backend` | ✅ |
| CI | GitHub Actions: lint → typecheck → test → build. Backend also runs `drizzle-kit migrate` on deploy | 🔜 (1) |
| Frontend deploys | Vercel (preview for every PR, production from `main`) | ✅ |
| Backend deploys | Railway auto-deploy from `main` | 🔜 (4) |
| Local DB | Docker Compose with `postgres:16` | 🔜 (1) |
| Error tracking | Sentry (`@sentry/react`, `@sentry/node`) | 🔜 (4) |
| Uptime | Better Stack (free tier), pinging `/api/health` | ⚪ |
| Secrets | Railway / Vercel env vars. Only `.env.example` is committed | 🔜 (1) |

## 6. Hardware (shop counter)

| Device | Connects via | Status |
|---|---|---|
| USB barcode scanner | Works as a keyboard (HID); the POS scan bar already handles it | ✅ |
| 80 mm thermal receipt printer (ESC/POS) | Browser print now, WebUSB direct later | ✅ / 🔜 (7) |
| Barcode label printer (TSC/Zebra) | Browser print to the label size | ✅ |
| Phone camera | `BarcodeDetector` for stock checks on the floor | 🔜 (7) |

## Not using (and why)
Redis (pg-boss covers jobs), GraphQL server (REST + Hono RPC is enough), Firebase/Supabase Auth (phone + PIN is simpler for staff), microservices (one shop, one service), Prisma (heavier than Drizzle and needs a generate step).
