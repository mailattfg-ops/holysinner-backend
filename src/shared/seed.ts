import { computeBill, ean13, gstRateFor, pointsEarned, variantSkus } from './billing'
import type {
  AuditEntry, Category, Customer, Expense, Offer, Product, Purchase, ReturnEntry, Sale, SaleItem,
  SalaryPayment, Settings, ShopifyState, Supplier, Transfer, Trip, User, Variant, CreditNote, ModuleKey,
} from './types'

// Deterministic RNG so every reset produces the same story.
function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const ALL_MODULES: ModuleKey[] = [
  'dashboard', 'pos', 'returns', 'inventory', 'barcodes', 'purchases', 'trips', 'online',
  'customers', 'finance', 'analytics', 'investors', 'users', 'settings',
]

const APPAREL = ['S', 'M', 'L', 'XL', 'XXL']
const WAIST = ['28', '30', '32', '34', '36']
const SHOE = ['UK 6', 'UK 7', 'UK 8', 'UK 9', 'UK 10']

const CAT: Record<Category, { hsn: string; sizes: string[] }> = {
  Shirts: { hsn: '6205', sizes: APPAREL },
  'T-Shirts': { hsn: '6109', sizes: APPAREL },
  Jeans: { hsn: '6203', sizes: WAIST },
  Trousers: { hsn: '6203', sizes: WAIST },
  Ethnic: { hsn: '6211', sizes: APPAREL },
  Jackets: { hsn: '6201', sizes: APPAREL },
  Sneakers: { hsn: '6404', sizes: SHOE },
  'Formal Shoes': { hsn: '6403', sizes: SHOE },
  Sandals: { hsn: '6402', sizes: SHOE },
  Accessories: { hsn: '4203', sizes: ['Free'] },
}

// [name, brand, category, gender, price, colours, popularity 0..1 (0 = dead stock), daysSinceCreated]
type Row = [string, string, Category, Product['gender'], number, string[], number, number?]
const CATALOG: Row[] = [
  ['Oxford Slim Fit Shirt', 'Allen Solly', 'Shirts', 'Men', 1899, ['White', 'Sky Blue', 'Black'], 0.9],
  ['Linen Casual Shirt', 'Holysinner', 'Shirts', 'Men', 1499, ['Beige', 'Olive', 'White'], 0.8],
  ['Checked Flannel Shirt', 'Peter England', 'Shirts', 'Men', 1699, ['Red', 'Navy'], 0.55],
  ['Mandarin Collar Shirt', 'Holysinner', 'Shirts', 'Men', 1299, ['Black', 'Maroon'], 0.6],
  ['Satin Party Shirt', 'Louis Philippe', 'Shirts', 'Men', 2799, ['Black', 'Wine'], 0.05],
  ['Printed Rayon Shirt', 'Holysinner', 'Shirts', 'Women', 1199, ['Floral Pink', 'Mint'], 0.5],
  ['Oversized Graphic Tee', 'Holysinner', 'T-Shirts', 'Unisex', 799, ['Black', 'Off-White', 'Red'], 1],
  ['Supima Crew Neck Tee', 'US Polo Assn', 'T-Shirts', 'Men', 999, ['White', 'Navy', 'Grey'], 0.85],
  ['Polo Pique T-Shirt', 'US Polo Assn', 'T-Shirts', 'Men', 1499, ['Black', 'Red', 'White'], 0.7],
  ['Acid Wash Tee', 'Holysinner', 'T-Shirts', 'Unisex', 899, ['Charcoal', 'Sand'], 0.65],
  ['Ribbed Crop Top', 'Only', 'T-Shirts', 'Women', 699, ['Black', 'White', 'Lilac'], 0.6],
  ['Neon Festival Tee', 'Holysinner', 'T-Shirts', 'Unisex', 649, ['Neon Green', 'Neon Pink'], 0],
  ['511 Slim Fit Jeans', "Levi's", 'Jeans', 'Men', 3299, ['Indigo', 'Black'], 0.75],
  ['Straight Fit Jeans', 'Wrangler', 'Jeans', 'Men', 2499, ['Mid Blue', 'Dark Blue'], 0.6],
  ['Ripped Skinny Jeans', 'Holysinner', 'Jeans', 'Women', 1999, ['Light Blue', 'Black'], 0.55],
  ['Wide Leg Jeans', 'Only', 'Jeans', 'Women', 2299, ['Ice Blue', 'Ecru'], 0.5, 12],
  ['Bootcut Jeans', 'Pepe Jeans', 'Jeans', 'Men', 2699, ['Stone Wash'], 0.03],
  ['Chino Trousers', 'Allen Solly', 'Trousers', 'Men', 1799, ['Khaki', 'Navy', 'Olive'], 0.65],
  ['Formal Pleated Trousers', 'Van Heusen', 'Trousers', 'Men', 2199, ['Charcoal', 'Black'], 0.45],
  ['Cargo Joggers', 'Holysinner', 'Trousers', 'Unisex', 1499, ['Black', 'Olive', 'Beige'], 0.7],
  ['Corduroy Trousers', 'Holysinner', 'Trousers', 'Men', 1899, ['Mustard', 'Brown'], 0.02],
  ['Cotton Kurta', 'Fabindia', 'Ethnic', 'Men', 1599, ['White', 'Saffron', 'Navy'], 0.6],
  ['Silk Blend Kurta Set', 'Manyavar', 'Ethnic', 'Men', 4999, ['Ivory', 'Maroon'], 0.35],
  ['Anarkali Kurti', 'W', 'Ethnic', 'Women', 2199, ['Teal', 'Rose'], 0.55],
  ['Chikankari Kurti', 'Biba', 'Ethnic', 'Women', 1799, ['White', 'Peach'], 0.5],
  ['Nehru Jacket', 'Manyavar', 'Ethnic', 'Men', 2999, ['Black', 'Royal Blue'], 0.2],
  ['Kasavu Mundu Set', 'Holysinner', 'Ethnic', 'Men', 1299, ['Off-White Gold'], 0.4],
  ['Bomber Jacket', 'Holysinner', 'Jackets', 'Unisex', 2999, ['Black', 'Olive'], 0.4],
  ['Denim Jacket', "Levi's", 'Jackets', 'Unisex', 4299, ['Mid Blue', 'Black'], 0.3],
  ['Puffer Jacket', 'Puma', 'Jackets', 'Unisex', 5499, ['Black', 'Red'], 0.01],
  ['Windcheater', 'Wildcraft', 'Jackets', 'Unisex', 2499, ['Grey', 'Navy'], 0.15],
  ['Air Runner Sneakers', 'Nike', 'Sneakers', 'Men', 6999, ['White', 'Black/Red'], 0.6],
  ['Court Classic Sneakers', 'Puma', 'Sneakers', 'Unisex', 4499, ['White', 'White/Navy'], 0.7],
  ['Chunky Dad Sneakers', 'Holysinner', 'Sneakers', 'Unisex', 2999, ['Cream', 'Black'], 0.75],
  ['Ultraboost Lite', 'Adidas', 'Sneakers', 'Men', 8999, ['Core Black'], 0.3],
  ['Canvas Low Tops', 'Converse', 'Sneakers', 'Unisex', 3999, ['Black', 'White', 'Red'], 0.65],
  ['Platform Sneakers', 'Skechers', 'Sneakers', 'Women', 4299, ['White', 'Pink'], 0.45, 8],
  ['LED Light-Up Sneakers', 'Holysinner', 'Sneakers', 'Unisex', 2499, ['Black'], 0],
  ['Leather Derby Shoes', 'Red Tape', 'Formal Shoes', 'Men', 3499, ['Tan', 'Black'], 0.5],
  ['Oxford Brogues', 'Hush Puppies', 'Formal Shoes', 'Men', 4999, ['Brown', 'Black'], 0.35],
  ['Chelsea Boots', 'Woodland', 'Formal Shoes', 'Men', 5499, ['Camel', 'Black'], 0.25],
  ['Patent Loafers', 'Bata', 'Formal Shoes', 'Men', 2799, ['Burgundy'], 0.02],
  ['Block Heel Pumps', 'Bata', 'Formal Shoes', 'Women', 1999, ['Nude', 'Black'], 0.4],
  ['Slide Sandals', 'Adidas', 'Sandals', 'Unisex', 1999, ['Black/White', 'Navy'], 0.7],
  ['Leather Kolhapuri', 'Holysinner', 'Sandals', 'Unisex', 1299, ['Tan', 'Brown'], 0.55],
  ['Floaters', 'Woodland', 'Sandals', 'Men', 2299, ['Olive', 'Black'], 0.45],
  ['Strappy Flats', 'Metro', 'Sandals', 'Women', 1499, ['Gold', 'Black'], 0.5],
  ['Leather Belt', 'Holysinner', 'Accessories', 'Men', 799, ['Black', 'Tan'], 0.8],
  ['Bifold Wallet', 'Tommy Hilfiger', 'Accessories', 'Men', 1999, ['Black', 'Brown'], 0.45],
  ['Canvas Cap', 'Holysinner', 'Accessories', 'Unisex', 499, ['Black', 'Red', 'Beige'], 0.75],
  ['Ankle Socks (3 pair)', 'Puma', 'Accessories', 'Unisex', 399, ['Assorted'], 0.9],
  ['Tote Bag', 'Holysinner', 'Accessories', 'Women', 999, ['Off-White', 'Black'], 0.4],
  ['Sunglasses Aviator', 'Fastrack', 'Accessories', 'Unisex', 1499, ['Gunmetal', 'Gold'], 0.35],
  ['Silk Pocket Square', 'Louis Philippe', 'Accessories', 'Men', 699, ['Paisley Red'], 0.01],
]

const SUPPLIERS: Supplier[] = [
  { id: 'sup1', name: 'Surat Textile Hub', city: 'Surat', state: 'Gujarat', phone: '9824012345', gstin: '24AABCS1234K1Z5' },
  { id: 'sup2', name: 'Tiruppur Knits Co.', city: 'Tiruppur', state: 'Tamil Nadu', phone: '9443056789', gstin: '33AACCT5678L1Z2' },
  { id: 'sup3', name: 'Agra Footwear Traders', city: 'Agra', state: 'Uttar Pradesh', phone: '9837011223', gstin: '09AAFCA9012M1Z8' },
  { id: 'sup4', name: 'Gandhi Nagar Denim', city: 'Delhi', state: 'Delhi', phone: '9811044556', gstin: '07AAGCG3456N1Z1' },
  { id: 'sup5', name: 'Ludhiana Woollens', city: 'Ludhiana', state: 'Punjab', phone: '9872033445', gstin: '03AAHCL7890P1Z4' },
  { id: 'sup6', name: 'Brand Distributors Kochi', city: 'Kochi', state: 'Kerala', phone: '9847066778', gstin: '32AAICB2468Q1Z6' },
]
const supplierFor = (c: Category, brand: string) =>
  brand !== 'Holysinner' ? 'sup6'
    : c === 'T-Shirts' ? 'sup2' : c === 'Jeans' || c === 'Trousers' ? 'sup4'
    : c === 'Jackets' ? 'sup5' : ['Sneakers', 'Formal Shoes', 'Sandals', 'Accessories'].includes(c) ? 'sup3' : 'sup1'

const FIRST = ['Aarav', 'Ananya', 'Rohit', 'Fathima', 'Akhil', 'Diya', 'Nikhil', 'Sana', 'Vishnu', 'Riya', 'Arjun', 'Meenakshi', 'Joel', 'Aisha', 'Kiran', 'Neha', 'Sreejith', 'Lakshmi', 'Abhishek', 'Anjali', 'Rahul', 'Gayathri', 'Mohammed', 'Sneha', 'Adithya', 'Priya', 'Varun', 'Nisha', 'Jithin', 'Kavya', 'Harsh', 'Divya', 'Basil', 'Pooja', 'Amal', 'Shruti', 'Sachin', 'Ann', 'Tejas', 'Malavika']
const LAST = ['Nair', 'Menon', 'Pillai', 'Thomas', 'Joseph', 'Kurian', 'Varghese', 'Sharma', 'Iyer', 'Reddy', 'Khan', 'Mathew', 'Das', 'Krishnan', 'George', 'Rao', 'Patel', 'Gupta', 'Abraham', 'Basheer']
const CITIES = ['Kochi', 'Kochi', 'Kochi', 'Aluva', 'Kakkanad', 'Edappally', 'Thrissur', 'Kottayam', 'Alappuzha', 'Kozhikode']
const ONLINE_STATES = ['Kerala', 'Karnataka', 'Tamil Nadu', 'Maharashtra', 'Delhi', 'Telangana', 'Kerala', 'Kerala']

export const SETTINGS: Settings = {
  shopName: 'Holysinner',
  tagline: 'Clothing & Footwear',
  address: '42/1180, MG Road, Ernakulam, Kochi 682016',
  state: 'Kerala',
  gstin: '32AAKFH4821R1Z9',
  phone: '+91 98470 55123',
  receiptFooter: 'Exchange within 7 days with bill & tags. No cash refunds on sale items.',
  pointsPer100: 1,
  pointValue: 1,
  deadStockDays: 90,
}

const SALES_MODULES: ModuleKey[] = ['dashboard', 'pos', 'returns', 'customers', 'barcodes']
const USERS: User[] = [
  { id: 'u1', name: 'Arjun Menon', role: 'Owner', phone: '9847011111', salary: 0, modules: ALL_MODULES, sharePct: 50, hue: 15 },
  { id: 'u2', name: 'Faisal Rahman', role: 'Manager', phone: '9847022222', salary: 32000, modules: ALL_MODULES.filter((m) => !['users', 'investors'].includes(m)), hue: 220 },
  { id: 'u3', name: 'Sneha Nair', role: 'Cashier', phone: '9847033333', salary: 18000, modules: SALES_MODULES, hue: 330 },
  { id: 'u4', name: 'Rahul Das', role: 'Cashier', phone: '9847044444', salary: 17000, modules: SALES_MODULES, hue: 160 },
  { id: 'u5', name: 'Vikram Singh', role: 'Purchase', phone: '9847055555', salary: 22000, modules: ['dashboard', 'inventory', 'barcodes', 'purchases', 'trips'], hue: 45 },
  { id: 'u6', name: 'Meera Kapoor', role: 'Investor', phone: '9847066666', salary: 0, modules: ['investors', 'analytics', 'dashboard'], sharePct: 30, hue: 280 },
  { id: 'u7', name: 'Rohan Iyer', role: 'Investor', phone: '9847077777', salary: 0, modules: ['investors', 'analytics', 'dashboard'], sharePct: 20, hue: 190 },
]

const OFFERS: Offer[] = [
  { code: 'WELCOME10', type: 'percent', value: 10, minBill: 1000, active: true, description: '10% off first purchase above ₹1,000' },
  { code: 'FESTIVE500', type: 'flat', value: 500, minBill: 4000, active: true, description: '₹500 off on bills above ₹4,000' },
  { code: 'HOLY15', type: 'percent', value: 15, minBill: 3000, active: true, description: '15% off Holysinner label above ₹3,000' },
  { code: 'MONSOON20', type: 'percent', value: 20, minBill: 2000, active: false, description: 'Monsoon sale (expired)' },
]

export interface SeedData {
  settings: Settings
  users: User[]
  products: Product[]
  variants: Variant[]
  customers: Customer[]
  sales: Sale[]
  returns: ReturnEntry[]
  creditNotes: CreditNote[]
  suppliers: Supplier[]
  purchases: Purchase[]
  trips: Trip[]
  expenses: Expense[]
  salaryPayments: SalaryPayment[]
  transfers: Transfer[]
  audit: AuditEntry[]
  offers: Offer[]
  shopify: ShopifyState
}

const DAY = 86400000
const iso = (t: number) => new Date(t).toISOString()
// Local month (YYYY-MM): an ISO slice would label 1 May 00:00 IST as April.
const ymd = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }

export function buildSeed(now = Date.now()): SeedData {
  const r = rng(20261010)
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)]
  const int = (a: number, b: number) => a + Math.floor(r() * (b - a + 1))
  const today = new Date(now); today.setHours(0, 0, 0, 0)
  const t0 = today.getTime()

  // --- products & variants
  const products: Product[] = []
  const variants: Variant[] = []
  const popularity = new Map<string, number>()
  let bc = 0
  CATALOG.forEach(([name, brand, category, gender, price, colors, pop, age], i) => {
    const id = `p${String(i + 1).padStart(3, '0')}`
    const margin = brand === 'Holysinner' ? 0.42 : 0.62 // own label = better margin
    products.push({
      id, name, brand, category, gender, hsn: CAT[category].hsn,
      price, mrp: Math.round((price * 1.15) / 50) * 50 - 1, cost: Math.round(price * margin),
      supplierId: supplierFor(category, brand),
      createdAt: iso(t0 - (age ?? int(150, 420)) * DAY), hue: int(0, 360),
    })
    popularity.set(id, pop)
    for (const { sku, color, size } of variantSkus(category, i + 1, colors, CAT[category].sizes)) {
      bc++
      const deadish = pop < 0.06
      variants.push({
        id: sku,
        productId: id, size, color,
        barcode: ean13(`890${String(4821).padStart(4, '0')}${String(bc).padStart(5, '0')}`),
        stockOffline: deadish ? int(6, 18) : r() < 0.08 ? int(0, 2) : int(2, 4 + Math.round(6 * (1 - pop))),
        stockOnline: deadish ? int(2, 8) : r() < 0.1 ? 0 : int(1, 4),
        reorderLevel: size === 'M' || size === 'L' || size === '32' || size === 'UK 8' ? 3 : 2,
      })
    }
  })
  const pById = new Map(products.map((p) => [p.id, p]))
  const vByProduct = new Map<string, Variant[]>()
  for (const v of variants) vByProduct.set(v.productId, [...(vByProduct.get(v.productId) ?? []), v])

  // --- customers
  const customers: Customer[] = Array.from({ length: 1400 }, (_, i) => {
    const name = `${pick(FIRST)} ${pick(LAST)}`
    return {
      id: `c${i + 1}`, name, phone: `9${int(400000000, 999999999)}`,
      email: r() < 0.6 ? `${name.split(' ')[0].toLowerCase()}${int(1, 99)}@gmail.com` : undefined,
      city: pick(CITIES), createdAt: iso(t0 - int(5, 400) * DAY), loyaltyPoints: 0,
      birthday: r() < 0.5 ? `${String(int(1, 12)).padStart(2, '0')}-${String(int(1, 28)).padStart(2, '0')}` : undefined,
    }
  })
  // a handful of loyal regulars get picked far more often
  const regulars = customers.slice(0, 40)

  // --- sales over 180 days
  const sales: Sale[] = []
  const cashiers = ['u3', 'u4', 'u2']
  const weighted = products.map((p) => ({ p, w: popularity.get(p.id)! < 0.06 ? 0 : popularity.get(p.id)! }))
  const totalW = weighted.reduce((s, x) => s + x.w, 0)
  const pickProduct = (dayAgo: number) => {
    for (;;) {
      let x = r() * totalW
      for (const { p, w } of weighted) {
        if ((x -= w) <= 0) {
          const created = (t0 - new Date(p.createdAt).getTime()) / DAY
          if (created < dayAgo) break // not on shelf yet
          return p
        }
      }
    }
  }
  // dead products only had a few sales long ago
  const deadIds = products.filter((p) => popularity.get(p.id)! < 0.06).map((p) => p.id)
  let invStore = 0, invOnline = 1000
  for (let d = 180; d >= 0; d--) {
    const day = t0 - d * DAY
    const dow = new Date(day).getDay()
    const trend = 0.8 + 0.4 * ((180 - d) / 180)
    const weekend = dow === 0 || dow === 6 ? 1.6 : 1
    const onam = d >= 23 && d <= 33 ? 1.8 : 1 // Onam season bump (late Aug / early Sep)
    const nStore = d === 0 ? Math.min(9, Math.round(new Date(now).getHours() * 0.8)) : Math.round((10 + r() * 8) * trend * weekend * onam)
    const nOnline = d === 0 ? 3 : Math.round((3 + r() * 4) * trend * onam)
    for (let k = 0; k < nStore + nOnline; k++) {
      const channel = k < nStore ? 'store' : 'online'
      const lines = r() < 0.55 ? 1 : r() < 0.75 ? 2 : 3
      const items: SaleItem[] = []
      for (let j = 0; j < lines; j++) {
        const p = d > 110 && r() < 0.05 ? pById.get(pick(deadIds))! : pickProduct(d)
        const v = pick(vByProduct.get(p.id)!)
        if (items.some((it) => it.variantId === v.id)) continue
        items.push({ variantId: v.id, productId: p.id, name: p.name, size: v.size, color: v.color, qty: r() < 0.9 ? 1 : 2, price: p.price, cost: p.cost, gstRate: gstRateFor(p.price) })
      }
      const customer = channel === 'online' || r() < 0.6 ? (r() < 0.15 ? pick(regulars) : pick(customers)) : undefined
      const shipState = channel === 'online' ? pick(ONLINE_STATES) : 'Kerala'
      const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0)
      const offer = r() < 0.18 ? OFFERS.find((o) => o.active && subtotal >= o.minBill && r() < 0.6) : undefined
      const bill = computeBill(items, { offer, interState: shipState !== 'Kerala', manualDiscount: !offer && r() < 0.08 ? 100 : 0 })
      const hour = channel === 'store' ? int(10, 20) : int(0, 23)
      const date = iso(Math.min(day + hour * 3600000 + int(0, 59) * 60000, now - (nStore + nOnline - k) * 600000))
      const modeR = r()
      sales.push({
        id: `s${sales.length + 1}`,
        invoiceNo: channel === 'store' ? `HS/26-27/${String(++invStore).padStart(5, '0')}` : `#SHP${++invOnline}`,
        date, channel, customerId: customer?.id, items,
        subtotal: bill.subtotal, discount: bill.discount, offerCode: bill.offerDiscount ? offer?.code : undefined,
        pointsRedeemed: 0, taxTotal: bill.taxTotal, total: bill.total,
        payments: [{ mode: channel === 'online' ? (modeR < 0.7 ? 'upi' : 'card') : modeR < 0.55 ? 'upi' : modeR < 0.85 ? 'cash' : 'card', amount: bill.total }],
        cashierId: channel === 'store' ? pick(cashiers) : 'u2',
        interState: shipState !== 'Kerala', status: 'paid',
      })
      if (customer) customer.loyaltyPoints += pointsEarned(bill.total, SETTINGS.pointsPer100)
    }
  }
  sales.sort((a, b) => a.date.localeCompare(b.date))

  // --- a few returns / exchanges
  const returns: ReturnEntry[] = []
  const creditNotes: CreditNote[] = []
  for (let i = 0; i < 14; i++) {
    const s = sales[int(100, sales.length - 40)]
    if (s.status !== 'paid' || s.channel !== 'store') continue
    const it = s.items[0]
    it.returnedQty = 1
    s.status = s.items.length === 1 && it.qty === 1 ? 'returned' : 'partial-return'
    const mode = pick(['exchange', 'exchange', 'credit-note', 'refund'] as const)
    const amount = Math.round(it.price * (s.total / s.subtotal || 1))
    const cn = mode === 'credit-note' ? `CN-${String(creditNotes.length + 101)}` : undefined
    if (cn) creditNotes.push({ no: cn, customerId: s.customerId, amount, balance: r() < 0.5 ? amount : 0, date: s.date })
    returns.push({
      id: `r${i + 1}`, saleId: s.id, date: iso(new Date(s.date).getTime() + int(1, 6) * DAY),
      items: [{ variantId: it.variantId, qty: 1, amount }], mode, amount, creditNoteNo: cn,
      reason: pick(['Size too small', 'Size too large', 'Colour mismatch', 'Defect at seam', 'Changed mind']), userId: pick(cashiers),
    })
  }

  // --- trips (buying trips to other states)
  const tripDefs = [
    ['u5', 'Surat', 'Gujarat', 160, 5, 'Ethnic & shirting fabric lots'],
    ['u5', 'Tiruppur', 'Tamil Nadu', 135, 3, 'Holysinner tees restock'],
    ['u2', 'Agra', 'Uttar Pradesh', 110, 4, 'Footwear sourcing — Kolhapuri & sneakers'],
    ['u5', 'Delhi', 'Delhi', 82, 4, 'Gandhi Nagar denim lots'],
    ['u5', 'Ludhiana', 'Punjab', 48, 5, 'Winter jackets pre-booking'],
    ['u2', 'Surat', 'Gujarat', 20, 4, 'Festive kurta stock for Diwali'],
    ['u5', 'Tiruppur', 'Tamil Nadu', 1, 4, 'Oversized tees — new drop'],
    ['u5', 'Bengaluru', 'Karnataka', -9, 3, 'Visit to Commercial Street wholesalers'],
  ] as const
  const trips: Trip[] = tripDefs.map(([staffId, city, state, ago, days, purpose], i) => {
    const start = t0 - ago * DAY
    const status = ago < 0 ? 'planned' : ago - days < 0 ? 'ongoing' : 'settled'
    const allowancePerDay = city === 'Delhi' || city === 'Bengaluru' ? 1500 : 1200
    return {
      id: `t${i + 1}`, staffId, city, state, startDate: iso(start), endDate: iso(start + days * DAY), purpose,
      allowancePerDay, advance: 15000 + int(0, 3) * 5000, tripPayment: staffId === 'u5' ? 3000 : 0,
      expenses: status === 'planned' ? [] : [
        { label: 'Train / flight', amount: int(18, 64) * 100 },
        { label: 'Hotel', amount: int(8, 16) * 100 * Math.min(days, status === 'ongoing' ? 2 : days) },
        { label: 'Local transport', amount: int(6, 20) * 100 },
        ...(r() < 0.6 ? [{ label: 'Courier / cargo to Kochi', amount: int(25, 60) * 100 }] : []),
      ],
      status,
    }
  })

  // --- purchases: periodic restocks + trip-linked lots
  const purchases: Purchase[] = []
  for (let d = 175; d >= 2; d -= int(4, 8)) {
    const sup = pick(SUPPLIERS)
    const prods = products.filter((p) => p.supplierId === sup.id)
    if (!prods.length) continue
    const trip = trips.find((t) => t.status !== 'planned' && t.state === sup.state && Math.abs((t0 - new Date(t.startDate).getTime()) / DAY - d) < 6)
    const items = Array.from({ length: int(3, 7) }, () => {
      const p = pick(prods)
      return { variantId: pick(vByProduct.get(p.id)!).id, qty: int(6, 24), cost: p.cost }
    })
    const total = items.reduce((s, i) => s + i.qty * i.cost, 0)
    purchases.push({
      id: `pu${purchases.length + 1}`, billNo: `${sup.city.slice(0, 3).toUpperCase()}/${int(1000, 9999)}`,
      date: iso(t0 - d * DAY + 11 * 3600000), supplierId: sup.id, items, total,
      paid: d < 20 && r() < 0.6 ? Math.round(total * 0.5) : total, tripId: trip?.id, channel: r() < 0.8 ? 'store' : 'online',
    })
  }

  // every trip that happened brings back a lot from that state's supplier
  for (const t of trips.filter((x) => x.status !== 'planned')) {
    const sup = SUPPLIERS.find((s) => s.state === t.state)
    const prods = products.filter((p) => p.supplierId === sup?.id)
    if (!sup || !prods.length) continue
    const items = Array.from({ length: int(4, 8) }, () => {
      const p = pick(prods)
      return { variantId: pick(vByProduct.get(p.id)!).id, qty: int(10, 30), cost: p.cost }
    })
    const total = items.reduce((s, i) => s + i.qty * i.cost, 0)
    const date = Math.min(new Date(t.endDate).getTime(), now - 3600000)
    purchases.push({
      id: `pu${purchases.length + 1}`, billNo: `${sup.city.slice(0, 3).toUpperCase()}/${int(1000, 9999)}`,
      date: iso(date), supplierId: sup.id, items, total,
      paid: t.status === 'ongoing' ? Math.round(total * 0.4) : total, tripId: t.id, channel: 'store',
    })
  }
  purchases.sort((a, b) => a.date.localeCompare(b.date))

  // --- expenses & salaries, monthly
  const expenses: Expense[] = []
  const salaryPayments: SalaryPayment[] = []
  for (let m = 6; m >= 0; m--) {
    const first = new Date(today.getFullYear(), today.getMonth() - m, 1).getTime()
    const add = (dayOfMonth: number, category: Expense['category'], amount: number, note: string) => {
      const t = first + (dayOfMonth - 1) * DAY + 10 * 3600000
      if (t <= now) expenses.push({ id: `e${expenses.length + 1}`, date: iso(t), category, amount, note })
    }
    add(1, 'Rent', 85000, 'Showroom rent — MG Road')
    add(6, 'Electricity', int(11, 18) * 1000, 'KSEB bill')
    add(9, 'Marketing', int(12, 30) * 1000, pick(['Instagram ads', 'Influencer collab', 'Flex boards', 'Meta ads']))
    add(12, 'Packaging', int(4, 8) * 1000, 'Bags, boxes, tissue')
    add(15, 'Shopify fees', int(3, 6) * 1000, 'Plan + transaction fees')
    add(20, 'Maintenance', int(2, 6) * 1000, pick(['AC service', 'Lighting repair', 'Mannequins']))
    add(25, 'Misc', int(2, 5) * 1000, 'Tea, cleaning, sundries')
    if (m > 0) for (const u of USERS.filter((u) => u.salary)) {
      salaryPayments.push({ id: `sp${salaryPayments.length + 1}`, userId: u.id, month: ymd(first), amount: u.salary, paidOn: iso(new Date(today.getFullYear(), today.getMonth() - m + 1, 1, 11).getTime()) })
    }
  }

  const transfers: Transfer[] = Array.from({ length: 10 }, (_, i) => ({
    id: `tr${i + 1}`, date: iso(t0 - int(1, 60) * DAY), variantId: pick(variants).id, qty: int(2, 6),
    from: r() < 0.6 ? 'store' : 'online', userId: pick(['u2', 'u5']),
  }))

  const audit: AuditEntry[] = [
    { id: 'a1', date: iso(now - 3600000 * 2), userId: 'u3', action: 'Bill created', detail: sales.findLast((x) => x.channel === 'store')!.invoiceNo },
    { id: 'a2', date: iso(now - 3600000 * 5), userId: 'u5', action: 'Purchase entry', detail: purchases.at(-1)!.billNo },
    { id: 'a3', date: iso(now - DAY), userId: 'u1', action: 'Access changed', detail: 'Rahul Das: + Customers' },
    { id: 'a4', date: iso(now - DAY * 1.3), userId: 'u2', action: 'Stock transfer', detail: '6 pcs Store → Online' },
    { id: 'a5', date: iso(now - DAY * 2), userId: 'u2', action: 'Shopify sync', detail: '142 SKUs synced' },
  ]

  return {
    settings: SETTINGS, users: USERS, products, variants, customers, sales, returns, creditNotes,
    suppliers: SUPPLIERS, purchases, trips, expenses, salaryPayments, transfers, audit, offers: OFFERS,
    shopify: { connected: true, storeUrl: 'holysinner.myshopify.com', lastSync: iso(now - 17 * 60000), autoSync: true },
  }
}
