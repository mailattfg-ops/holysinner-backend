// Who may read what: one list used by the GET routes and by /bootstrap, so the two can't drift apart.
import type { ModuleKey } from '../shared/types'

type Readers = readonly ModuleKey[]

export const READ = {
  customers: ['customers', 'pos', 'returns', 'online', 'analytics'], // screens that show names and phones
  sales: ['dashboard', 'analytics', 'returns', 'customers', 'pos', 'investors'],
  creditNotes: ['pos', 'returns'],
  returns: ['returns', 'pos', 'analytics', 'dashboard'],
  suppliers: ['purchases', 'inventory', 'finance'],
  purchases: ['purchases', 'finance', 'trips'], // the dashboard gets only the dues total
  trips: ['trips', 'purchases', 'finance', 'dashboard', 'investors'],
  transfers: ['inventory', 'online'],
  gst: ['finance', 'analytics'], // output tax per HSN / supply type, no cost or profit
  money: ['finance', 'investors'], // P&L, expenses, salaries: the dashboard shows profit only to these too
  cost: ['finance', 'investors', 'analytics', 'inventory', 'purchases'], // unit costs and therefore margins
} as const satisfies Record<string, Readers>

export const canRead = (modules: readonly ModuleKey[], readers: Readers) => readers.some((m) => modules.includes(m))

// Unit cost (and so margin) is owner-level info: counter staff get products and bills without it.
const seesCost = (viewer: { modules: readonly ModuleKey[] }) => canRead(viewer.modules, READ.cost)
type Viewer = { modules: readonly ModuleKey[] }
export const productsFor = <T extends { cost: number }>(viewer: Viewer, rows: T[]) =>
  (seesCost(viewer) ? rows : rows.map(({ cost: _cost, ...p }) => p))
export const salesFor = <T extends { items: { cost: number }[] }>(viewer: Viewer, rows: T[]) =>
  (seesCost(viewer) ? rows : rows.map((s) => ({ ...s, items: s.items.map(({ cost: _cost, ...i }) => i) })))

// Activity-feed entries belong to the module whose screen produced them; someone sees an entry only if
// they have that module. Actions not listed (and anything new) are owner-only until mapped here.
export const ACTION_MODULE: Record<string, ModuleKey> = {
  'Bill created': 'pos',
  Refund: 'returns', Exchange: 'returns', 'Credit note issued': 'returns',
  'Customer added': 'customers', 'Customer updated': 'customers',
  'Product added': 'inventory', 'Stock adjusted': 'inventory', 'Stock transfer': 'inventory', 'Barcodes printed': 'barcodes',
  'Purchase entry': 'purchases', 'Supplier payment': 'purchases', 'Supplier added': 'purchases',
  'Trip planned': 'trips', 'Trip started': 'trips', 'Trip expense': 'trips', 'Trip expense removed': 'trips', 'Trip settled': 'trips',
  'Expense added': 'finance', 'Salary paid': 'finance',
  'Profit shares updated': 'investors',
  'User added': 'users', 'User updated': 'users', 'User deactivated': 'users', 'Access changed': 'users', 'PIN reset': 'users',
  'Settings updated': 'settings', 'Offer created': 'settings', 'Offer updated': 'settings',
  'Shopify sync': 'online',
}
