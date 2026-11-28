import { sql } from 'drizzle-orm'
import { boolean, check, index, integer, jsonb, numeric, pgTable, serial, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import type { Category, Expense, ModuleKey, PayMode, Product, Role, TripTotals } from '../shared/types'

// Every table enables RLS with no policies: only the backend (DB owner) can read/write; Supabase's anon key sees nothing.
const at = () => timestamp({ withTimezone: true }).notNull().defaultNow()
const money = () => numeric({ precision: 12, scale: 2, mode: 'number' })

// ---------- foundation
export const counters = pgTable('counters', {
  key: text().primaryKey(), // e.g. invoice:26-27, cn, shopify
  value: integer().notNull().default(0),
}).enableRLS()

export const auditLog = pgTable('audit_log', {
  id: serial().primaryKey(),
  at: at(),
  userId: text(),
  action: text().notNull(),
  detail: text().notNull(),
  entity: text(),
  entityId: text(),
}).enableRLS()

export const appLogs = pgTable('app_logs', {
  id: serial().primaryKey(),
  at: at(),
  level: text({ enum: ['warn', 'error'] }).notNull(),
  source: text().notNull(), // api | job:<name>
  message: text().notNull(),
  context: jsonb(),
}).enableRLS()

// ---------- users & auth
export const users = pgTable('users', {
  id: text().primaryKey(),
  name: text().notNull(),
  role: text().$type<Role>().notNull(),
  phone: text().notNull().unique(),
  pinHash: text().notNull(),
  failedLogins: integer().notNull().default(0),
  lockedUntil: timestamp({ withTimezone: true }),
  salary: money().notNull().default(0), // monthly; 0 for investors
  modules: text().array().$type<ModuleKey[]>().notNull(),
  sharePct: numeric({ precision: 5, scale: 2, mode: 'number' }), // profit share (owner/investors)
  hue: integer().notNull().default(0),
  active: boolean().notNull().default(true),
  createdAt: at(),
}).enableRLS()

export const refreshTokens = pgTable('refresh_tokens', {
  tokenHash: text().primaryKey(), // sha256 of the cookie value; the raw token is never stored
  userId: text().notNull().references(() => users.id),
  expiresAt: timestamp({ withTimezone: true }).notNull(),
  revoked: boolean().notNull().default(false),
  createdAt: at(),
}).enableRLS()

// ---------- settings & offers
export const settings = pgTable('settings', {
  id: integer().primaryKey().default(1), // single row
  shopName: text().notNull(),
  tagline: text().notNull(),
  address: text().notNull(),
  state: text().notNull(),
  gstin: text().notNull(),
  phone: text().notNull(),
  receiptFooter: text().notNull(),
  pointsPer100: integer().notNull(),
  pointValue: numeric({ precision: 6, scale: 2, mode: 'number' }).notNull(),
  deadStockDays: integer().notNull(),
}, (t) => [check('settings_single_row', sql`${t.id} = 1`)]).enableRLS()

export const offers = pgTable('offers', {
  code: text().primaryKey(), // uppercase
  type: text({ enum: ['percent', 'flat'] }).notNull(),
  value: money().notNull(),
  minBill: money().notNull().default(0),
  active: boolean().notNull().default(true),
  description: text().notNull().default(''),
}, (t) => [check('offers_percent_max', sql`${t.type} <> 'percent' or ${t.value} <= 100`)]).enableRLS()

// ---------- catalog
export const suppliers = pgTable('suppliers', {
  id: text().primaryKey(),
  name: text().notNull(),
  city: text().notNull(),
  state: text().notNull(),
  phone: text().notNull().default(''),
  gstin: text().notNull().default(''),
  createdAt: at(),
}).enableRLS()

export const products = pgTable('products', {
  id: text().primaryKey(), // p001…
  name: text().notNull(),
  brand: text().notNull(),
  category: text().$type<Category>().notNull(),
  gender: text().$type<Product['gender']>().notNull(),
  hsn: text().notNull(),
  cost: money().notNull(), // per-unit purchase cost
  price: money().notNull(), // selling price, GST inclusive
  mrp: money().notNull(),
  supplierId: text().notNull().references(() => suppliers.id),
  hue: integer().notNull(),
  createdAt: at(),
}).enableRLS()

export const variants = pgTable('variants', {
  id: text().primaryKey(), // SKU
  productId: text().notNull().references(() => products.id),
  size: text().notNull(),
  color: text().notNull(),
  barcode: text().notNull().unique(), // EAN-13
  stockOffline: integer().notNull().default(0),
  stockOnline: integer().notNull().default(0),
  reorderLevel: integer().notNull().default(3),
}, (t) => [
  index('variants_product_idx').on(t.productId),
  check('variants_stock_not_negative', sql`${t.stockOffline} >= 0 and ${t.stockOnline} >= 0`), // overselling fails loudly
]).enableRLS()

// ---------- stock ledger
// Every change to a variant balance writes one row here (via lib/stock.ts); the variant columns are the cached balance.
export const MOVEMENT_KINDS = ['opening', 'adjust', 'transfer', 'sale', 'return', 'purchase', 'shopify'] as const
export type MovementKind = (typeof MOVEMENT_KINDS)[number]

export const stockMovements = pgTable('stock_movements', {
  id: serial().primaryKey(),
  at: at(),
  variantId: text().notNull().references(() => variants.id),
  channel: text({ enum: ['store', 'online'] }).notNull(),
  qty: integer().notNull(), // ± change to that channel's balance
  kind: text({ enum: MOVEMENT_KINDS }).notNull(),
  refId: text(), // transfer / sale / purchase id
  reason: text().notNull().default(''),
  userId: text(),
}, (t) => [
  index('stock_movements_variant_idx').on(t.variantId, t.at),
  check('stock_movements_qty_not_zero', sql`${t.qty} <> 0`),
]).enableRLS()

// ---------- customers
export const customers = pgTable('customers', {
  id: text().primaryKey(), // c1…
  name: text().notNull(),
  phone: text().notNull().unique(), // 10 digits, the key cashiers search by
  email: text(),
  city: text().notNull(),
  birthday: text(), // MM-DD
  notes: text(),
  loyaltyPoints: integer().notNull().default(0), // changed only by checkout and returns
  createdAt: at(),
}, (t) => [check('customers_points_not_negative', sql`${t.loyaltyPoints} >= 0`)]).enableRLS()

// ---------- sales
export interface Payment { mode: PayMode; amount: number }

export const sales = pgTable('sales', {
  id: text().primaryKey(), // s1…
  invoiceNo: text().notNull().unique(), // HS/<FY>/<5 digits> (store), #SHP<n> (online)
  date: at(),
  channel: text({ enum: ['store', 'online'] }).notNull(),
  customerId: text().references(() => customers.id),
  subtotal: money().notNull(),
  discount: money().notNull(), // offer + manual
  offerCode: text(),
  pointsRedeemed: money().notNull().default(0), // ₹ value
  taxTotal: money().notNull(),
  total: money().notNull(),
  payments: jsonb().$type<Payment[]>().notNull(), // read with the sale, never queried alone
  cashierId: text().notNull().references(() => users.id),
  interState: boolean().notNull().default(false),
  status: text({ enum: ['paid', 'returned', 'partial-return'] }).notNull().default('paid'),
}, (t) => [index('sales_date_idx').on(t.date), index('sales_customer_idx').on(t.customerId)]).enableRLS()

// Name, size, price and cost are copied at sale time, so later catalog edits never change past bills.
export const saleItems = pgTable('sale_items', {
  id: serial().primaryKey(),
  saleId: text().notNull().references(() => sales.id),
  variantId: text().notNull().references(() => variants.id),
  productId: text().notNull().references(() => products.id),
  name: text().notNull(),
  size: text().notNull(),
  color: text().notNull(),
  qty: integer().notNull(),
  price: money().notNull(), // unit, GST inclusive
  cost: money().notNull(),
  gstRate: integer().notNull(),
  returnedQty: integer().notNull().default(0),
}, (t) => [
  index('sale_items_sale_idx').on(t.saleId),
  index('sale_items_product_idx').on(t.productId),
  check('sale_items_qty', sql`${t.qty} > 0 and ${t.returnedQty} between 0 and ${t.qty}`),
]).enableRLS()

export const creditNotes = pgTable('credit_notes', {
  no: text().primaryKey(), // CN-101…
  customerId: text().references(() => customers.id),
  amount: money().notNull(),
  balance: money().notNull(),
  date: at(),
}, (t) => [check('credit_notes_balance', sql`${t.balance} >= 0 and ${t.balance} <= ${t.amount}`)]).enableRLS()

// ---------- returns
export interface ReturnLine { variantId: string; qty: number; amount: number }

export const returns = pgTable('returns', {
  id: text().primaryKey(), // r1…
  saleId: text().notNull().references(() => sales.id),
  date: at(),
  items: jsonb().$type<ReturnLine[]>().notNull(), // read with the return; per-line returned qty lives on sale_items
  mode: text({ enum: ['refund', 'exchange', 'credit-note'] }).notNull(),
  amount: money().notNull(),
  creditNoteNo: text().references(() => creditNotes.no),
  reason: text().notNull(),
  userId: text().notNull().references(() => users.id),
}, (t) => [index('returns_sale_idx').on(t.saleId), index('returns_date_idx').on(t.date)]).enableRLS()

// ---------- buying trips
export interface TripExpense { label: string; amount: number }

export const trips = pgTable('trips', {
  id: text().primaryKey(), // t1…
  staffId: text().notNull().references(() => users.id),
  city: text().notNull(),
  state: text().notNull(),
  startDate: timestamp({ withTimezone: true }).notNull(),
  endDate: timestamp({ withTimezone: true }).notNull(),
  purpose: text().notNull(),
  allowancePerDay: money().notNull(),
  advance: money().notNull(),
  tripPayment: money().notNull(), // fixed payment on top of the allowance
  expenses: jsonb().$type<TripExpense[]>().notNull().default([]),
  status: text({ enum: ['planned', 'ongoing', 'settled'] }).notNull().default('planned'),
  settled: jsonb().$type<TripTotals>(), // tripCost frozen at settlement, so later edits can't rewrite what was paid
  settledAt: timestamp({ withTimezone: true }),
}, (t) => [check('trips_dates', sql`${t.endDate} >= ${t.startDate}`)]).enableRLS()

// ---------- purchases & supplier payments
export interface PurchaseLine { variantId: string; qty: number; cost: number }
export interface Allocation { purchaseId: string; amount: number }

export const purchases = pgTable('purchases', {
  id: text().primaryKey(), // pu1…
  billNo: text().notNull(), // the supplier's bill number
  date: at(), // bill date
  supplierId: text().notNull().references(() => suppliers.id),
  items: jsonb().$type<PurchaseLine[]>().notNull(), // read with the bill; stock history is in stock_movements
  total: money().notNull(),
  paid: money().notNull().default(0), // sum of supplier_payments allocations
  tripId: text().references(() => trips.id), // the buying trip this lot came from
  channel: text({ enum: ['store', 'online'] }).notNull(), // where the received stock went
}, (t) => [
  uniqueIndex('purchases_supplier_bill_uq').on(t.supplierId, t.billNo), // the same supplier bill can't be entered twice
  check('purchases_paid', sql`${t.paid} >= 0 and ${t.paid} <= ${t.total}`),
]).enableRLS()

export const supplierPayments = pgTable('supplier_payments', {
  id: serial().primaryKey(),
  supplierId: text().notNull().references(() => suppliers.id),
  date: at(),
  amount: money().notNull(),
  allocations: jsonb().$type<Allocation[]>().notNull(), // which bills it settled, oldest first
  userId: text().references(() => users.id),
}, (t) => [index('supplier_payments_supplier_idx').on(t.supplierId), check('supplier_payments_amount', sql`${t.amount} > 0`)]).enableRLS()

// ---------- finance
export const expenses = pgTable('expenses', {
  id: text().primaryKey(), // e1…
  date: at(),
  category: text().$type<Expense['category']>().notNull(),
  amount: money().notNull(),
  note: text().notNull(),
  userId: text().references(() => users.id),
}, (t) => [index('expenses_date_idx').on(t.date), check('expenses_amount', sql`${t.amount} > 0`)]).enableRLS()

export const salaryPayments = pgTable('salary_payments', {
  id: text().primaryKey(), // sp1…
  userId: text().notNull().references(() => users.id),
  month: text().notNull(), // YYYY-MM
  amount: money().notNull(), // the user's salary when paid
  paidOn: at(),
}, (t) => [uniqueIndex('salary_payments_user_month_uq').on(t.userId, t.month)]).enableRLS() // one salary per person per month
