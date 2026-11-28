import { beforeAll, describe, expect, it } from 'vitest'
import { seed } from '../src/db/seed'
import { ACTION_MODULE } from '../src/lib/access'
import { computeBill, gstRateFor } from '../src/shared/billing'
import { buildSeed } from '../src/shared/seed'
import type { AuditEntry, Product, Sale, Variant } from '../src/shared/types'
import { call, json, login, OWNER } from './helpers'

const CASHIER = '9847033333' // u3: dashboard, pos, returns, customers, barcodes
const PURCHASE = '9847055555' // u5: dashboard, inventory, barcodes, purchases, trips
const INVESTOR = '9847066666' // u6: investors, analytics, dashboard
const demo = buildSeed()
type Boot = Record<string, unknown> & {
  me: { id: string }; users: Record<string, unknown>[]; products: Product[]; sales: Sale[]; audit: AuditEntry[]; supplierDues: number
}
let boot: Record<'owner' | 'cashier' | 'investor', Boot>
beforeAll(async () => {
  await seed()
  const get = async (phone: string) => json<Boot>(await call('/bootstrap', { token: (await login(phone)).token }))
  boot = { owner: await get(OWNER), cashier: await get(CASHIER), investor: await get(INVESTOR) }
})

const length = (b: Boot, key: string) => (b[key] as unknown[]).length

describe('bootstrap', () => {
  it('gives the owner every slice of the demo, matching the frontend seed', () => {
    const b = boot.owner
    for (const key of ['products', 'variants', 'customers', 'sales', 'returns', 'creditNotes', 'suppliers', 'purchases', 'trips', 'transfers', 'expenses', 'salaryPayments', 'offers', 'users'] as const) {
      expect([key, length(b, key)]).toEqual([key, (demo[key] as unknown[]).length])
    }
    expect(b.me.id).toBe('u1')
    expect(b.settings).toMatchObject({ shopName: demo.settings.shopName })
    expect(b.supplierDues).toBeCloseTo(demo.purchases.reduce((t, p) => t + p.total - p.paid, 0), 2)
    expect(b.products[0]).toHaveProperty('cost')
    expect(b.users.find((u) => u.id === 'u3')).toMatchObject({ phone: '9847033333', salary: 18000 })
    for (const a of demo.audit) expect(b.audit).toContainEqual(expect.objectContaining({ action: a.action, detail: a.detail, userId: a.userId }))
  })

  it('gives a cashier only what the till needs: no costs, no back office, no one else’s phone or salary', () => {
    const b = boot.cashier
    expect(length(b, 'sales')).toBe(demo.sales.length) // dashboard charts
    expect(b.sales.every((s) => s.items.every((i) => !('cost' in i)))).toBe(true)
    expect(b.products.every((p) => !('cost' in p))).toBe(true)
    for (const key of ['purchases', 'suppliers', 'expenses', 'salaryPayments', 'transfers']) expect([key, length(b, key)]).toEqual([key, 0])
    expect(length(b, 'customers')).toBe(demo.customers.length)
    expect(b.supplierDues).toBeGreaterThan(0) // the dashboard tile, without the bills
    const other = b.users.find((u) => u.id === 'u2')!
    expect(other).toMatchObject({ name: 'Faisal Rahman', role: 'Manager' })
    for (const hidden of ['phone', 'salary', 'modules', 'sharePct']) expect(other).not.toHaveProperty(hidden)
    expect(b.users.find((u) => u.id === 'u3')).toHaveProperty('modules') // their own profile is whole
    const mine = new Set(Object.entries(ACTION_MODULE).filter(([, m]) => ['pos', 'returns', 'customers', 'barcodes', 'dashboard'].includes(m)).map(([a]) => a))
    expect(b.audit.length).toBeGreaterThan(0)
    expect(b.audit.every((a) => mine.has(a.action))).toBe(true)
  })

  it('gives an investor the money slices and only their own share, but not the back office', () => {
    const b = boot.investor
    expect(length(b, 'expenses')).toBe(demo.expenses.length)
    expect(length(b, 'salaryPayments')).toBe(demo.salaryPayments.length)
    expect(b.sales[0]!.items[0]).toHaveProperty('cost') // analytics + margins
    for (const key of ['purchases', 'suppliers', 'transfers', 'creditNotes']) expect([key, length(b, key)]).toEqual([key, 0])
    expect(b.users.filter((u) => u.sharePct).map((u) => [u.id, u.sharePct])).toEqual([['u6', 30]]) // u6 is this investor
    expect(boot.owner.users.filter((u) => u.sharePct).map((u) => [u.id, u.sharePct])).toEqual([['u1', 50], ['u6', 30], ['u7', 20]])
    expect(b.users.find((u) => u.id === 'u1')).not.toHaveProperty('phone')
  })

  it('needs a login', async () => {
    expect((await call('/bootstrap')).status).toBe(401)
  })
})

describe('cost is hidden on every route a cashier uses', () => {
  it('products, barcode lookup and the checkout response', async () => {
    const cashier = (await login(CASHIER)).token
    expect((await json<Product[]>(await call('/products', { token: cashier })))[0]).not.toHaveProperty('cost')
    const v = demo.variants.find((x) => x.stockOffline > 0)!
    expect((await json<{ product: Product }>(await call(`/variants/barcode/${v.barcode}`, { token: cashier }))).product).not.toHaveProperty('cost')
    const price = demo.products.find((p) => p.id === v.productId)!.price
    const total = computeBill([{ price, qty: 1, gstRate: gstRateFor(price) }]).total
    const res = await call('/sales/checkout', { body: { lines: [{ variantId: v.id, qty: 1 }], payments: [{ mode: 'cash', amount: total }] }, token: cashier })
    expect(res.status).toBe(201)
    expect((await json<{ sale: Sale; variants: Variant[] }>(res)).sale.items[0]).not.toHaveProperty('cost')
    expect((await json<Product[]>(await call('/products', { token: (await login(PURCHASE)).token })))[0]).toHaveProperty('cost')
  })
})

describe('activity feed', () => {
  it('shows new actions newest first, filtered by module', async () => {
    const owner = (await login(OWNER)).token
    await call('/customers', { body: { name: 'Feed Test', phone: '7000000001' }, token: (await login(CASHIER)).token })
    const feed = await json<AuditEntry[]>(await call('/activity?limit=5', { token: owner }))
    expect(feed).toHaveLength(5)
    expect(feed[0]).toMatchObject({ action: 'Customer added', detail: 'Feed Test', userId: 'u3' })
    const buyerFeed = await json<AuditEntry[]>(await call('/activity', { token: (await login(PURCHASE)).token }))
    expect(buyerFeed.some((a) => a.action === 'Customer added' || a.action === 'Bill created')).toBe(false)
    expect(buyerFeed.some((a) => a.action === 'Purchase entry')).toBe(true)
    expect((await call('/activity?limit=999', { token: owner })).status).toBe(400)
  })
})
