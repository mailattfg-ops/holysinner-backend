import { sql } from 'drizzle-orm'
import { db } from '../../db'
import { purchases } from '../../db/schema'
import { canRead, productsFor, READ, salesFor } from '../../lib/access'
import { publicUser, type UserRow } from '../../lib/auth'
import type { ModuleKey } from '../../shared/types'
import { listActivity } from '../activity/service'
import { listProducts, listSuppliers, listVariants } from '../catalog/service'
import { listCustomers } from '../customers/service'
import { listExpenses, listSalaries } from '../finance/service'
import { listPurchases } from '../purchases/service'
import { listReturns } from '../returns/service'
import { listCreditNotes, listSales } from '../sales/service'
import { listOffers, getSettings } from '../settings/service'
import { listTransfers } from '../stock/service'
import { listTrips } from '../trips/service'
import { listUsers } from '../users/service'

const FEED_SIZE = 100 // the frontend kept the last 300; the activity feeds show far fewer
type PublicUser = ReturnType<typeof publicUser>

// Everyone needs names and avatars for bills, trips and the feed; the rest of a profile only where a screen uses it.
function directory(viewer: UserRow, list: PublicUser[]) {
  const full = canRead(viewer.modules, ['users'])
  return list.map((u) => (full || u.id === viewer.id ? u : {
    id: u.id, name: u.name, role: u.role, hue: u.hue, active: u.active,
    ...(canRead(viewer.modules, ['finance']) && { salary: u.salary }), // payroll
    // Profit split: an Investor sees only their own share (their own full profile above), as on /investors/summary.
    ...(viewer.role !== 'Investor' && canRead(viewer.modules, READ.money) && u.sharePct && { sharePct: u.sharePct }),
  }))
}

const supplierDues = async () =>
  Number((await db.select({ due: sql<string>`coalesce(sum(${purchases.total} - ${purchases.paid}), 0)` }).from(purchases))[0]!.due)

interface Slice { readers?: readonly ModuleKey[]; load: (viewer: UserRow) => Promise<unknown>; empty?: unknown }

// The Zustand store's slices. A slice the user's modules can't read comes back empty, so the store shape stays whole.
const SLICES: Record<string, Slice> = {
  settings: { load: () => getSettings() },
  offers: { load: () => listOffers() },
  users: { load: async (v) => directory(v, await listUsers()) },
  products: { load: async (v) => productsFor(v, await listProducts()) },
  variants: { load: () => listVariants() },
  customers: { readers: READ.customers, load: () => listCustomers() },
  sales: { readers: READ.sales, load: async (v) => salesFor(v, await listSales()) },
  returns: { readers: READ.returns, load: () => listReturns() },
  creditNotes: { readers: READ.creditNotes, load: () => listCreditNotes() },
  suppliers: { readers: READ.suppliers, load: () => listSuppliers() },
  purchases: { readers: READ.purchases, load: () => listPurchases() },
  trips: { readers: READ.trips, load: () => listTrips() },
  transfers: { readers: READ.transfers, load: () => listTransfers() },
  expenses: { readers: READ.money, load: () => listExpenses() },
  salaryPayments: { readers: READ.money, load: () => listSalaries() },
  audit: { load: (v) => listActivity(v, FEED_SIZE) },
  supplierDues: { readers: ['dashboard', 'purchases'], load: () => supplierDues(), empty: 0 }, // the dashboard tile, without the bills
}

// One call to fill the app after login. Slices load one after another on purpose: firing them all at once would
// overrun the DB pool, which can hang through Supabase's transaction pooler (see progress.md).
export async function bootstrap(viewer: UserRow) {
  const out: Record<string, unknown> = { me: publicUser(viewer) }
  for (const [key, s] of Object.entries(SLICES)) {
    out[key] = !s.readers || canRead(viewer.modules, s.readers) ? await s.load(viewer) : (s.empty ?? [])
  }
  return out
}
