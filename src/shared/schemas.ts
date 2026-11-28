// API input schemas, shared by routes (and the frontend forms from step 14).
import { z } from 'zod'
import { ALL_MODULES } from './seed'
import type { ModuleKey } from './types'

export const PHONE_RE = /^[6-9]\d{9}$/ // Indian mobile, same as frontend AddCustomerDialog

export const phone = z.string().regex(PHONE_RE, 'Enter a valid 10-digit mobile number')
export const pin = z.string().regex(/^\d{4,6}$/, 'PIN must be 4–6 digits')
export const role = z.enum(['Owner', 'Manager', 'Cashier', 'Purchase', 'Investor'])
export const moduleKey = z.enum(ALL_MODULES as [ModuleKey, ...ModuleKey[]])

export const loginInput = z.object({ phone, pin })

export const userCreate = z.object({
  name: z.string().trim().min(2, 'Enter the name'),
  phone,
  pin,
  role,
  salary: z.number().min(0).default(0),
  modules: z.array(moduleKey).min(1, 'Give at least one module'),
  hue: z.number().int().min(0).max(359).optional(),
}) // no sharePct: shares change only through PUT /investors/shares, which keeps the total at 100%

export const userPatch = userCreate.omit({ pin: true }).partial().extend({ active: z.boolean().optional() })
  .refine((p) => Object.keys(p).length > 0, 'Nothing to update')

// The whole split at once: everyone listed gets their %, everyone else stops holding a share.
export const sharesInput = z.object({
  shares: z.array(z.object({ userId: z.string().min(1), sharePct: z.number().positive('A share must be above 0%').max(100).multipleOf(0.01) }))
    .min(1, 'Add at least one holder'),
})
  .refine((s) => new Set(s.shares.map((x) => x.userId)).size === s.shares.length, 'Each person can appear once')
  .refine((s) => Math.round(s.shares.reduce((t, x) => t + x.sharePct, 0) * 100) === 10_000, 'Shares must add up to exactly 100%')

export const investorSummaryQuery = z.object({ months: z.coerce.number().int().min(1).max(24).default(6) })

export const pinReset = z.object({ pin })

export const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/

// Every field optional: the Settings page saves "Shop profile" and "Billing & loyalty" separately.
export const settingsPatch = z.object({
  shopName: z.string().trim().min(1, 'Enter the shop name'),
  tagline: z.string().trim(),
  address: z.string().trim().min(1, 'Enter the address'),
  state: z.string().trim().min(1, 'Enter the state'),
  gstin: z.string().trim().toUpperCase().regex(GSTIN_RE, 'Enter a valid 15-character GSTIN'),
  phone: z.string().trim().min(1, 'Enter the phone number'),
  receiptFooter: z.string().trim(),
  pointsPer100: z.number().int().min(0),
  pointValue: z.number().min(0),
  deadStockDays: z.number().int().min(1),
}).partial().refine((p) => Object.keys(p).length > 0, 'Nothing to update')

export const offerCode = z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,20}$/, 'Code: 2–20 letters or digits')

export const offerInput = z.object({
  type: z.enum(['percent', 'flat']),
  value: z.number().positive('Value must be above 0'),
  minBill: z.number().min(0).default(0),
  active: z.boolean().default(true),
  description: z.string().trim().default(''),
}).refine((o) => o.type === 'flat' || o.value <= 100, { message: 'A percent offer can be at most 100', path: ['value'] })

const blankOr = <T extends z.ZodType>(s: T) => z.union([z.literal(''), s]).default('')

export const supplierInput = z.object({
  name: z.string().trim().min(1, 'Enter the supplier name'),
  city: z.string().trim().min(1, 'Enter the city'),
  state: z.string().trim().min(1, 'Enter the state'),
  phone: blankOr(phone),
  gstin: blankOr(z.string().trim().toUpperCase().regex(GSTIN_RE, 'Enter a valid 15-character GSTIN')),
})

export const category = z.enum(['Shirts', 'T-Shirts', 'Jeans', 'Trousers', 'Ethnic', 'Jackets', 'Sneakers', 'Formal Shoes', 'Sandals', 'Accessories'])
const uniqueNames = (what: string) => z.array(z.string().trim().min(1)).min(1, `Add at least one ${what}`).transform((a) => [...new Set(a)])

export const productCreate = z.object({
  name: z.string().trim().min(1, 'Enter the product name'),
  brand: z.string().trim().min(1, 'Enter the brand'),
  category,
  gender: z.enum(['Men', 'Women', 'Unisex']),
  hsn: z.string().regex(/^\d{4,8}$/, 'HSN is 4–8 digits'),
  cost: z.number().positive('Cost must be above 0'),
  price: z.number().positive('Price must be above 0'),
  mrp: z.number().positive().optional(), // defaults to price; never below price (same as the Add product dialog)
  supplierId: z.string().min(1),
  sizes: uniqueNames('size'),
  colors: uniqueNames('colour'),
  stock: z.number().int().min(0).default(0), // opening store stock per variant
}).transform((p) => ({ ...p, mrp: Math.max(p.mrp ?? p.price, p.price) }))

const channel = z.enum(['store', 'online'])
const sku = z.string().trim().min(1, 'Pick an item') // exact SKU: accessories end in mixed-case 'Free'

export const stockAdjust = z.object({
  variantId: sku,
  channel,
  delta: z.number().int().min(-10000).max(10000).refine((n) => n !== 0, 'Quantity must not be 0'), // + adds, − removes
  reason: z.string().trim().min(1, 'Pick a reason').max(60),
})

export const stockTransfer = z.object({
  variantId: sku,
  qty: z.number().int().min(1, 'Move at least 1').max(10000),
  from: channel,
})

// Accepts "+91 98470 12345", "098470 12345" etc. and keeps the 10 digits (same as the frontend's cleanPhone).
export const cleanPhone = (p: string) => p.replace(/\D/g, '').replace(/^(91|0)(?=\d{10}$)/, '')
export const BDAY_RE = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/
const orNull = <T extends z.ZodType>(s: T) => z.union([z.literal('').transform(() => null), s]).optional() // '' clears

export const customerInput = z.object({
  name: z.string().trim().min(1, 'Enter the customer name'),
  phone: z.string().transform(cleanPhone).pipe(phone),
  email: orNull(z.email('Enter a valid email').trim().toLowerCase()),
  city: z.string().trim().min(1).default('Kochi'),
  birthday: orNull(z.string().regex(BDAY_RE, 'Birthday should be MM-DD, e.g. 08-21')),
  notes: orNull(z.string().trim().max(500)),
})

// Points are not editable here: only checkout and returns change them.
export const customerPatch = customerInput.partial().omit({ city: true }).extend({ city: z.string().trim().min(1).optional() })
  .refine((p) => Object.keys(p).length > 0, 'Nothing to update')

export const customerSearch = z.object({ q: z.string().trim().max(50).optional() })

// The client sends only ids, quantities, codes and how it pays; the server prices everything (agent.md §5).
export const checkoutInput = z.object({
  lines: z.array(z.object({ variantId: sku, qty: z.number().int().min(1).max(999) })).min(1, 'Cart is empty').max(100),
  customerId: z.string().min(1).optional(),
  offerCode: offerCode.optional(),
  manualDiscount: z.number().min(0).default(0), // ₹ flat
  pointsToRedeem: z.number().int().min(0).default(0), // points, valued at settings.pointValue
  payments: z.array(z.object({ mode: z.enum(['cash', 'upi', 'card', 'credit-note']), amount: z.number().positive() })).max(5),
  creditNoteNo: z.string().trim().toUpperCase().optional(),
  interState: z.boolean().default(false),
})

// Unit costs come from the supplier's bill, so here the client's numbers are the source of truth.
export const purchaseInput = z.object({
  billNo: z.string().trim().min(1, 'Enter the supplier bill number').max(40),
  date: z.iso.datetime({ offset: true }).transform((d) => new Date(d)).optional(), // bill date; defaults to now
  supplierId: z.string().min(1, 'Pick a supplier'),
  items: z.array(z.object({ variantId: sku, qty: z.number().int().min(1).max(10000), cost: z.number().min(0).max(1_000_000) }))
    .min(1, 'Add at least one item').max(200),
  paid: z.number().min(0).default(0), // paid at entry; the rest is settled later, oldest bill first
  tripId: z.string().min(1).optional(),
  channel: channel.default('store'),
})

export const supplierPaymentInput = z.object({ supplierId: z.string().min(1), amount: z.number().positive('Enter an amount').max(100_000_000) })

const isoDate = z.iso.datetime({ offset: true }).transform((d) => new Date(d))

export const tripCreate = z.object({
  staffId: z.string().min(1, 'Pick a staff member'),
  city: z.string().trim().min(1, 'Enter the destination city'),
  state: z.string().trim().min(1, 'Pick the state'),
  startDate: isoDate,
  endDate: isoDate,
  purpose: z.string().trim().max(200).default('').transform((p) => p || 'Stock sourcing'), // same default as the Plan trip dialog
  allowancePerDay: z.number().min(0).max(100_000),
  advance: z.number().min(0).max(10_000_000),
  tripPayment: z.number().min(0).max(10_000_000).default(0),
}).refine((t) => t.endDate >= t.startDate, { message: 'End date must be after the start date', path: ['endDate'] })

export const tripExpense = z.object({
  label: z.string().trim().min(1, 'Enter a label').max(80),
  amount: z.number().positive('Enter an amount').max(10_000_000),
})

export const EXPENSE_CATEGORIES = ['Rent', 'Electricity', 'Marketing', 'Packaging', 'Shopify fees', 'Maintenance', 'Misc'] as const

export const expenseInput = z.object({
  category: z.enum(EXPENSE_CATEGORIES),
  amount: z.number().positive('Enter an amount above ₹0').max(100_000_000),
  note: z.string().trim().max(200).default(''), // blank → the category, as in the Add expense dialog
  date: isoDate.optional(), // defaults to now
})

// Amount is never sent: the server pays the user's salary on record.
export const salaryInput = z.object({
  userId: z.string().min(1, 'Pick a staff member'),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Month is YYYY-MM'),
})

export const pnlQuery = z.object({ from: isoDate, to: isoDate }).refine((r) => r.to > r.from, { message: '"to" must be after "from"', path: ['to'] })

// Amounts are worked out on the server from what the bill actually charged.
export const returnInput = z.object({
  saleId: z.string().min(1),
  items: z.array(z.object({ variantId: sku, qty: z.number().int().min(1).max(999) })).min(1, 'Pick at least one item').max(100),
  mode: z.enum(['refund', 'exchange', 'credit-note']),
  reason: z.string().trim().min(1, 'Pick a reason').max(100),
})
