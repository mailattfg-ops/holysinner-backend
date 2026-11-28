# Holysinner ERP — Backend Plan

The frontend (`frontend/`) is a working, front-end-only demo. All data lives in one persisted Zustand store
(`frontend/src/lib/store.ts`), seeded by `frontend/src/lib/seed.ts`. This plan replaces that store's localStorage with a
real API and database **while keeping the store's shape**, so most pages don't have to change.

---

## 1. What the frontend does today (feature inventory)

| Module (route) | What it does | Store actions / data it uses |
|---|---|---|
| Dashboard `/` | KPIs, sales trend, hourly chart, category donut, top products, alerts (low stock, dead stock, birthdays), recent bills, activity feed | `sales`, `variants`, `products`, `audit` |
| Analytics `/analytics` | Date-range and channel filters, trend vs. previous period, fast/slow movers, category/brand/size insights, hour×day heatmap, CSV and print reports | read-only, `components/analytics/lib.ts` |
| Investors `/investors` | Monthly net profit, split by `sharePct` (`splitProfit`), edit the share split (must total 100%) | `profitAndLoss`, `updateUser(sharePct)` |
| POS `/pos` | Barcode scan or search, cart, customer picker (phone is the key), offer codes, manual discount, loyalty-point redeem, split payments (cash/UPI/card/credit note), IGST toggle, hold/recall bills (localStorage), receipt print, WhatsApp receipt (`wa.me` link), F2/F9 hotkeys | `checkout`, `addCustomer` |
| Returns `/returns` | Find a sale, return some or all lines, refund / exchange / credit note; refund is pro-rated by what was actually paid | `processReturn`, `creditNotes` |
| Customers `/customers` | List, segments (VIP/Regular/New/Dormant), detail sheet, edit, birthday, WhatsApp message link, copy an offer | `addCustomer`, `updateCustomer` |
| Online `/online` | Shopify connection status, simulated sync (pulls online orders), auto-sync toggle, push stock to online, store vs. online chart | `shopifySync`, `transferStock`, `shopify` |
| Inventory `/inventory` | Products × variants (size/colour), store vs. online stock, low-stock alerts, dead stock with suggested actions, add product (creates the variant grid and EAN-13 barcodes), stock adjust, transfer | `addProduct`, `updateVariant`, `transferStock`, `upsertOffer(CLEAR30)` |
| Barcodes `/barcodes` | Pick variants and print barcode labels (JsBarcode + `window.print`) | read-only |
| Purchases `/purchases` | Purchase entry (supplier bill, items, channel the stock goes to, linked trip), suppliers tab, supplier payment settled FIFO across unpaid bills | `addPurchase`, `addSupplier`, direct `setState` for payments |
| Trips `/trips` | Plan a buying trip (staff, city, dates, allowance per day, advance, fixed payment), add expenses, start, settle (balance = allowance + expenses + payment − advance) | `addTrip`, `updateTrip` |
| Finance `/finance` | P&L statement by period, CSV export, expenses, salaries (pay per month), cash flow, GST summary | `addExpense`, `paySalary`, `profitAndLoss` |
| Users `/users` | Staff list, roles, per-module access toggles and presets, salary, "view as" | `addUser`, `updateUser`, `setUser` |
| Settings `/settings` | Shop profile and GSTIN, receipt footer, loyalty rules, dead-stock days, offers CRUD, device status (printer, scanner, WhatsApp = Phase 2), theme, reset demo | `updateSettings`, `upsertOffer`, `resetDemo` |

**Domain rules already coded on the frontend. The server must reuse them, not re-implement them:**
- Prices include GST. GST slab is 5% if the unit price is ≤ ₹2500, otherwise 18% (`gstRateFor`).
- Bill: offer → manual discount → points, spread pro-rata across lines, tax backed out per slab, total rounded to the nearest rupee (`computeBill`).
- Intra-state sales are split CGST+SGST; inter-state sales are IGST.
- Points earned are `floor(total/100) × pointsPer100`. One redeemed point is worth `pointValue` rupees.
- The return amount is pro-rated by `total/subtotal`. A sale becomes `partial-return` or `returned`.
- Net revenue, COGS and gross profit come from `saleNet`. Period P&L comes from `profitAndLoss`: sales − expenses − salaries − trips that are not just planned.
- In the profit split, the last holder absorbs the rounding difference (`splitProfit`).
- Barcodes are EAN-13 with the `8904821` prefix (`ean13`).

**Gaps in the demo that the backend must fix:**
1. Invoice numbers come from `sales.length + 1`. Two tills billing at the same moment get duplicates, and GST requires a gapless series for each financial year.
2. Stock can be oversold when two tills sell the same piece. `Math.max(0, …)` hides the problem.
3. The supplier payment mutates `purchases.paid` through `useStore.setState` with no payment record behind it.
4. Stock adjustments are `updateVariant` + `log`, so there is no reason or ledger row. Transfers are the only stock movement that gets recorded.
5. The audit log is capped at 300 rows, and user "login" is just a dropdown.
6. Shopify sync and the WhatsApp integration are simulated.

---

## 2. Stack (chosen for less code and shared types)

| Concern | Choice | Why |
|---|---|---|
| Runtime | Node 22 + TypeScript (ESM) | Same language as the frontend, so billing math is shared, not ported |
| HTTP | **Hono** + `@hono/zod-validator` | Small, fast, and its typed RPC client (`hono/client`) gives end-to-end types with no codegen |
| DB | **PostgreSQL 16** | Transactions, row locks, CHECK constraints, aggregates for reports |
| ORM | **Drizzle** + drizzle-kit migrations | Typed SQL, no runtime magic, the schema is the source of truth |
| Validation | **Zod** (schemas live in `shared/`) | One schema validates on the client and the server |
| Auth | Phone + 4–6 digit PIN (staff) → JWT access token (15 min) + httpOnly refresh cookie | Fits a shop counter. No email flow needed |
| Jobs | **Supabase Queues (`pgmq`) + `pg_cron` + `pg_net`** | Open-source Postgres extensions, free on Supabase. No always-on worker is needed, which suits serverless |
| Logs | `pino` to stdout + an `app_logs` table | Free; errors stay queryable in the same DB |
| Tests | Vitest against in-memory PGlite (embedded Postgres); local dev also uses PGlite when `DATABASE_URL` is unset | Real Postgres, zero setup, no Docker |
| Hosting | API on **Vercel Functions** (`bom1` Mumbai), DB on **Supabase** (`ap-south-1` Mumbai), frontend on Vercel | Free tiers, one vendor for both deploys, API and DB in the same city |

Money is stored as `numeric(12,2)` and read through Drizzle as `mode: 'number'`. It stays in rupees, the same as the frontend, so no paise conversion is needed.

**Serverless rules (Vercel + Supabase):**
- Connect through the Supavisor pooler (transaction mode, port 6543) with `prepare: false`. Each function instance keeps a small pool (`max: 1–3`).
- No in-memory state between requests: no caches, no in-memory rate limiters, no timers. Anything that must survive a request goes in Postgres.
- A request must never wait on Shopify or WhatsApp. Enqueue to `pgmq` and return.
- Job runner: every 2 minutes `pg_cron` calls `pg_net` to POST `/api/jobs/run` (protected by a `JOBS_SECRET` header). The handler reads a small batch from each queue, processes it and deletes it. Failed messages come back after the visibility timeout; after 5 reads they move to `app_logs` as dead letters.
- Plans: **Supabase Free + Vercel Hobby** (decided 2026-11-26). Hobby is non-commercial only; if that becomes a problem, the fallback is Vercel Pro or Cloudflare Workers, where Hono runs with only a different entry file.
- Keep-alive: `.github/workflows/keep-alive.yml` pings `/health` every 6 days so the free Supabase project never pauses.

---

## 3. Repo layout

```
Holysinner/
├─ frontend/                 existing Vite app
├─ shared/                   ← moved out of frontend/src/lib (pure, no React)
│  ├─ billing.ts             computeBill, gstRateFor, splitProfit, ean13, pointsEarned
│  ├─ money.ts               saleNet, profitAndLoss, tripCost, lastSoldByProduct
│  ├─ types.ts               domain types (as today)
│  └─ schemas.ts             Zod inputs: CheckoutInput, ReturnInput, PurchaseInput…
└─ backend/
   ├─ src/
   │  ├─ index.ts            app + route mounting
   │  ├─ db/schema.ts        Drizzle tables (one file while it stays < ~300 lines)
   │  ├─ db/index.ts         pool + `tx()` helper
   │  ├─ lib/                auth.ts (jwt, requireModule), audit.ts, counters.ts, stock.ts, errors.ts
   │  ├─ modules/<name>/     routes.ts (HTTP only) + service.ts (business logic)
   │  └─ jobs/               runner.ts (drains pgmq), shopify.ts, whatsapp.ts
   ├─ api/index.ts           Vercel entry: `export default handle(app)`
   ├─ drizzle/               generated migrations (+ a custom one enabling pgmq/pg_cron/pg_net and RLS)
   └─ seed.ts                reuses shared seed builder → `npm run db:seed`
```

The frontend imports `@shared/*` through a tsconfig path alias. `npm run check` keeps running against `shared/billing.ts`.

---

## 4. Data model

Every table has `id` (text/uuid) and `created_at`. Foreign keys are enforced.

| Table | Key columns | Notes |
|---|---|---|
| `users` | name, role, phone (unique), pin_hash, failed_logins, locked_until, salary, modules text[], share_pct, hue, active | Investors and the Owner hold `share_pct`. A CHECK on the app side keeps the sum at 100 |
| `settings` | single row: shop fields, points_per_100, point_value, dead_stock_days | |
| `suppliers` | name, city, state, phone, gstin | |
| `products` | name, brand, category, gender, hsn, cost, price, mrp, supplier_id, hue, archived | |
| `variants` | id = SKU, product_id, size, color, barcode (unique), stock_offline, stock_online, reorder_level, shopify_inventory_item_id | `CHECK (stock_offline >= 0 AND stock_online >= 0)`, so overselling fails loudly |
| `stock_movements` | variant_id, channel, qty (±), kind (`sale`,`return`,`purchase`,`adjust`,`transfer`,`shopify`), ref_id, reason, user_id | The ledger. Variant stock columns are the cached balance and are updated in the same transaction |
| `customers` | name, phone (unique), email, city, loyalty_points, birthday (MM-DD), notes | |
| `offers` | code (PK), type, value, min_bill, active, description | |
| `sales` | invoice_no (unique), date, channel, customer_id, subtotal, discount, offer_code, points_redeemed, points_earned, tax_total, total, cashier_id, inter_state, status, shopify_order_id (unique, nullable) | |
| `sale_items` | sale_id, variant_id, product_id, name, size, color, qty, price, cost, gst_rate, returned_qty | Snapshot of the price and cost at the time of sale |
| `sale_payments` | sale_id, mode, amount, credit_note_no | |
| `returns` + `return_items` | sale_id, mode, amount, credit_note_no, reason, user_id / variant_id, qty, amount | |
| `credit_notes` | no (PK), customer_id, amount, balance | |
| `purchases` + `purchase_items` | bill_no, date, supplier_id, total, paid, trip_id, channel / variant_id, qty, cost | |
| `supplier_payments` | supplier_id, amount, date, mode, allocations jsonb `[{purchaseId, amount}]` | The server does the FIFO allocation and updates `purchases.paid` |
| `trips` + `trip_expenses` | staff_id, city, state, start/end, purpose, allowance_per_day, advance, trip_payment, status | |
| `expenses` | date, category, amount, note | |
| `salary_payments` | user_id, month (YYYY-MM), amount, paid_on | `UNIQUE(user_id, month)` |
| `counters` | key (e.g. `invoice:26-27`, `shopify`, `cn`), value | Gapless numbering, `SELECT … FOR UPDATE` |
| `audit_log` | user_id, action, detail, entity, entity_id, at | Written in the same transaction as the change. Never truncated |
| `shopify_state` | single row: connected, store_url, access_token (encrypted), last_sync, auto_sync | |
| `refresh_tokens` | user_id, token_hash, expires_at, revoked | |
| `app_logs` | level, source (`api`/`job:<name>`), message, context jsonb, at | Warnings, errors and dead-letter jobs. `pg_cron` deletes rows older than 30 days |

Queues (`pgmq`, not tables we define): `shopify_inventory`, `shopify_orders`, `whatsapp`.

Indexes: `sales(date)`, `sales(customer_id)`, `sale_items(product_id)`, `stock_movements(variant_id, created_at)`, `purchases(supplier_id)`, `audit_log(at desc)`.

---

## 5. API (every route is under `/api`, JSON in and out; mutations return the updated rows)

Each route is guarded by `requireModule('<key>')`, using the same `ModuleKey`s as `NAV`. Owner-only routes are marked **(owner)**.

```
POST   /auth/login            {phone, pin} → {accessToken, user}   (refresh cookie set)
POST   /auth/refresh | /auth/logout      GET /auth/me
GET    /bootstrap             slices the user's modules can see (replaces localStorage hydrate)

POST   /sales/checkout        CheckoutInput → Sale        [pos]   ← server recomputes everything
GET    /sales?from&to&channel&customerId  GET /sales/:id  GET /sales/invoice/:no
POST   /returns               ReturnInput → ReturnEntry   [returns]
GET    /returns   GET /credit-notes/:no

GET/POST /customers   PATCH /customers/:id   GET /customers?q=phone|name   [customers|pos]

GET/POST /products    PATCH /products/:id                        [inventory]
GET    /variants/barcode/:code                                    [pos|inventory|barcodes]
PATCH  /variants/:id  (reorderLevel)
POST   /stock/adjust   {variantId, channel, delta, reason}
POST   /stock/transfer {variantId, qty, from}                     [inventory|online]

GET/POST /suppliers   POST /suppliers/:id/payments {amount}       [purchases]
GET/POST /purchases                                               [purchases]

GET/POST /trips   PATCH /trips/:id   POST /trips/:id/expenses   POST /trips/:id/settle   [trips]

GET/POST /expenses   GET /salaries   POST /salaries {userId, month}   [finance]
GET    /reports/pnl?from&to   GET /reports/gst?month   GET /reports/:key.csv   [finance|analytics]
GET    /investors/summary?months=6   PUT /investors/shares (owner)        [investors]

GET/POST /users   PATCH /users/:id   PUT /users/:id/pin           [users] (owner)
GET/PATCH /settings   GET /offers   PUT /offers/:code             [settings]
GET    /audit?before&limit                                         [dashboard|users]

GET/PATCH /shopify   POST /shopify/connect   POST /shopify/sync   [online]
POST   /webhooks/shopify/orders-create | orders-cancelled | refunds-create   (HMAC verified, no JWT, enqueue + 200)
POST   /jobs/run              (JOBS_SECRET header, called by pg_cron)
GET    /health                no auth; runs `select 1` → {ok, db_ms}. A GitHub Actions ping every 6 days keeps Supabase awake
```

Errors are always `{ error: { code, message } }` with a 4xx/5xx status. The frontend already shows `toast.error(message)`.

---

## 6. Critical flows (each one is a single DB transaction)

**Checkout** (`sales/service.ts`)
1. Validate the input with Zod. Load the variants and products `FOR UPDATE`.
2. Build the lines from **DB prices**, then run `computeBill` from `shared/`. Client totals are ignored.
3. Check: the offer is active and `minBill` is met, points ≤ the customer's balance, and the credit-note balance covers the credit-note payment. Payments must sum to the total. Cash may exceed the total, and the change is returned.
4. Get the next invoice number from `counters` (`HS/26-27/00001` for the store, `#SHP1001…` for online). The financial year runs April to March.
5. Insert the sale, items and payments. Decrement stock and write `stock_movements`. The CHECK constraint rejects overselling with a 409 error: "Only 2 left of SKU …".
6. Update the customer's points and the credit-note balance. Write the audit row.

**Return**: lock the sale and check `qty ≤ sold − returned`. Compute the amount pro-rata, put the stock back to the sale's channel, set the status, and issue a credit note from the counter if one is needed.

**Purchase**: insert the bill and items, add the stock to the chosen channel, and write the movements. If the item cost changed, optionally update `products.cost` (owner setting). Note that cost is snapshotted per sale, so past profit doesn't change.

**Supplier payment**: lock the supplier's unpaid purchases oldest first, allocate FIFO, update `paid`, and insert `supplier_payments` with the allocations.

**Trip settle**: compute `tripCost` from `shared/` and store the settled totals, so later changes to the allowance don't rewrite history.

**Shopify**
- Connect: OAuth or a custom-app token for the store. Map each variant by SKU to its `inventory_item_id`.
- `orders/create` webhook: verify the HMAC, enqueue to `shopify_orders` and reply 200 straight away (Shopify expects a quick answer). The job is idempotent on `shopify_order_id` and runs the same checkout service with `channel='online'` and the prices from the order.
- Every movement on online stock enqueues a `variantId` to `shopify_inventory`. The job removes duplicate variants in the batch, then calls `inventorySetQuantities`. Retries come from the `pgmq` visibility timeout.
- When `auto_sync` is on, `pg_cron` reconciles orders and inventory every 15 minutes.

**WhatsApp (Phase 3)**: Cloud API templates for receipts and birthday/offer campaigns, sent as a queued job with a delivery log. Until then, `wa.me` links stay as they are.

**Printing and barcodes** stay on the client (browser print now, ESC/POS over WebUSB later). The server only provides the receipt and label data.

---

## 7. Security

- PINs are hashed with argon2. Five failed logins lock the account for 15 minutes (`users.failed_logins` / `locked_until`, stored in Postgres because serverless has no shared memory).
- **Supabase RLS is enabled on every table with no policies.** The backend connects as the DB owner and bypasses RLS; the public `anon` key can't read anything. The service-role key and DB password stay in Vercel env vars only.
- Access is enforced on the server from `users.modules`. The UI hiding a page is never enough. Owner-only actions are users, shares, settings reset and PIN reset.
- Investors get read-only access: the `investors`, `analytics` and `dashboard` GET routes.
- CORS is limited to the Vercel domain. Secure headers are set. Shopify webhooks are verified by HMAC. The Shopify token is encrypted at rest.
- Backups: a nightly `pg_dump` in GitHub Actions, encrypted and kept 30 days. The free Supabase plan has no point-in-time restore, so we don't rely on it. Nothing is hard-deleted: products are archived, and sales are reversed only through returns.

---

## 8. Frontend migration (smallest diff)

1. Move the pure logic into `shared/` and update the imports. Behaviour stays the same and `npm run check` must still pass.
2. Add `frontend/src/lib/api.ts`: the Hono client, token handling, and refresh on 401.
3. In `store.ts`, replace `persist` with `hydrate()` calling `GET /bootstrap`. Each action becomes `async`: it calls the API and then merges the returned rows into state. Page code keeps reading `useStore((s) => s.sales)`.
4. Add a login page. The avatar menu's "switch user" becomes logout. "View as" stays an owner-only preview.
5. Replace the direct `setState` supplier payment with `paySupplier()`, and the stock adjust with `adjustStock()`.
6. Later, when sales grow past about 50k rows: switch the Analytics and Finance pages to `/reports/*` aggregates instead of loading every sale.

---

## 9. Phases

| Phase | Scope | Done when |
|---|---|---|
| **0. Shared core** | Move the billing and money logic to `shared/` and add Zod schemas | Frontend builds and `check` passes |
| **1. Foundation** | backend scaffold, Drizzle schema + migrations, seed from the shared seed, auth + `requireModule`, audit helper, error format | Login works and `/bootstrap` returns the seed |
| **2. Core retail** | products/variants/stock ledger, customers, offers, settings, checkout, returns, credit notes | Two parallel checkouts can't oversell, and invoice numbers are gapless |
| **3. Back office** | suppliers, purchases, supplier payments, trips, expenses, salaries, users, investors | The finance P&L matches the frontend numbers on the seed |
| **4. Frontend switch** | api.ts, hydrate, async actions, login page | The demo runs fully against the API. localStorage is only used for held bills and the theme |
| **5. Reports** | `/reports/pnl`, `/reports/gst` (GSTR-1 HSN summary, B2C), CSV endpoints | The accountant can export a month |
| **6. Shopify** | connect, webhooks, inventory push, auto-sync job | Real orders land as online sales and the online stock mirrors the ERP |
| **7. WhatsApp + devices** | WhatsApp Cloud API receipts/campaigns, ESC/POS printing, camera scan | |

Not planned (YAGNI): multiple shops or tenants, microservices, GraphQL, Redis, always-on workers.
