export type ModuleKey =
  | 'dashboard' | 'pos' | 'returns' | 'inventory' | 'barcodes' | 'purchases'
  | 'trips' | 'online' | 'customers' | 'finance' | 'analytics' | 'investors'
  | 'users' | 'settings'

export type Category =
  | 'Shirts' | 'T-Shirts' | 'Jeans' | 'Trousers' | 'Ethnic' | 'Jackets'
  | 'Sneakers' | 'Formal Shoes' | 'Sandals' | 'Accessories'

export type Channel = 'store' | 'online'
export type PayMode = 'cash' | 'upi' | 'card' | 'credit-note'

export interface Product {
  id: string
  name: string
  brand: string
  category: Category
  gender: 'Men' | 'Women' | 'Unisex'
  hsn: string
  cost: number // per unit purchase cost
  price: number // selling price, GST inclusive (Indian MRP convention)
  mrp: number
  supplierId: string
  createdAt: string
  hue: number // swatch hue for the product tile (no images in demo)
}

export interface Variant {
  id: string // SKU
  productId: string
  size: string
  color: string
  barcode: string // EAN-13
  stockOffline: number
  stockOnline: number
  reorderLevel: number
}

export interface Customer {
  id: string
  name: string
  phone: string
  email?: string
  city: string
  createdAt: string
  loyaltyPoints: number
  birthday?: string
  notes?: string
}

export interface SaleItem {
  variantId: string
  productId: string
  name: string
  size: string
  color: string
  qty: number
  price: number // unit price, GST inclusive
  cost: number // unit cost
  gstRate: number // 5 | 18
  returnedQty?: number
}

export interface Sale {
  id: string
  invoiceNo: string
  date: string // ISO
  channel: Channel
  customerId?: string
  items: SaleItem[]
  subtotal: number // sum price*qty (incl GST)
  discount: number // bill discount + offer
  offerCode?: string
  pointsRedeemed: number // rupee value
  taxTotal: number
  total: number // payable
  payments: { mode: PayMode; amount: number }[]
  cashierId: string
  interState: boolean // IGST vs CGST+SGST
  status: 'paid' | 'returned' | 'partial-return'
}

export interface ReturnEntry {
  id: string
  saleId: string
  date: string
  items: { variantId: string; qty: number; amount: number }[]
  mode: 'refund' | 'exchange' | 'credit-note'
  amount: number
  creditNoteNo?: string
  reason: string
  userId: string
}

export interface CreditNote {
  no: string
  customerId?: string
  amount: number
  balance: number
  date: string
}

export interface Supplier {
  id: string
  name: string
  city: string
  state: string
  phone: string
  gstin: string
}

export interface Purchase {
  id: string
  billNo: string
  date: string
  supplierId: string
  items: { variantId: string; qty: number; cost: number }[]
  total: number
  paid: number
  tripId?: string
  channel: Channel // where the received stock goes
}

export interface Trip {
  id: string
  staffId: string
  city: string
  state: string
  startDate: string
  endDate: string
  purpose: string
  allowancePerDay: number
  advance: number
  tripPayment: number // fixed payment for the trip, on top of allowance
  expenses: { label: string; amount: number }[]
  status: 'planned' | 'ongoing' | 'settled'
  settled?: TripTotals | null // tripCost frozen at settlement (server); P&L uses it instead of recomputing
}

export interface TripTotals { days: number; allowance: number; expenses: number; payment: number; total: number; balance: number }

export type Role = 'Owner' | 'Manager' | 'Cashier' | 'Purchase' | 'Investor'

export interface User {
  id: string
  name: string
  role: Role
  phone: string
  salary: number // monthly, 0 for investors
  modules: ModuleKey[]
  sharePct?: number // profit share, investors/owner
  hue: number
  active?: boolean // false once deactivated (server mode); the demo never sets it
}

export interface Expense {
  id: string
  date: string
  category: 'Rent' | 'Electricity' | 'Marketing' | 'Packaging' | 'Shopify fees' | 'Maintenance' | 'Misc'
  amount: number
  note: string
}

export interface SalaryPayment {
  id: string
  userId: string
  month: string // YYYY-MM
  amount: number
  paidOn: string
}

export interface Transfer {
  id: string
  date: string
  variantId: string
  qty: number
  from: Channel
  userId: string
}

export interface AuditEntry {
  id: string
  date: string
  userId: string
  action: string
  detail: string
}

export interface Offer {
  code: string
  type: 'percent' | 'flat'
  value: number
  minBill: number
  active: boolean
  description: string
}

export interface Settings {
  shopName: string
  tagline: string
  address: string
  state: string
  gstin: string
  phone: string
  receiptFooter: string
  pointsPer100: number // loyalty points earned per ₹100
  pointValue: number // ₹ per point on redeem
  deadStockDays: number
}

export interface ShopifyState {
  connected: boolean
  storeUrl: string
  lastSync: string
  autoSync: boolean
}
