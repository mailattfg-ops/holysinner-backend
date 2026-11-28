import { beforeAll, describe, expect, it } from 'vitest'
import { seed } from '../src/db/seed'
import { ean13 } from '../src/shared/billing'
import { buildSeed } from '../src/shared/seed'
import type { Product, Variant } from '../src/shared/types'
import { call, json, login, OWNER } from './helpers'

const CASHIER = '9847033333' // no inventory / purchases
const PURCHASE = '9847055555' // inventory + purchases

const demo = buildSeed()
let owner: string
beforeAll(async () => {
  await seed()
  owner = (await login(OWNER)).token
})

const newProduct = {
  name: 'Festival Kurta', brand: 'Holysinner', category: 'Ethnic', gender: 'Men', hsn: '6211',
  cost: 700, price: 1499, mrp: 999, supplierId: 'sup1',
  sizes: ['M', 'L'], colors: ['Neon Green', 'Neon Pink', 'Neon Green'], stock: 4,
}

describe('catalog reads', () => {
  it('serves the full demo catalog to any logged-in user', async () => {
    const { token } = await login(CASHIER)
    const ps = await json<Product[]>(await call('/products', { token }))
    const vs = await json<Variant[]>(await call('/variants', { token }))
    expect(ps).toHaveLength(demo.products.length)
    expect(vs).toHaveLength(demo.variants.length)
    expect(new Set(vs.map((v) => v.id)).size).toBe(vs.length) // SKUs are unique (colour-code clash fixed)
    expect(ps.find((p) => p.id === 'p001')).toMatchObject({ price: 1899 })
    expect(ps[0]).not.toHaveProperty('cost') // cashiers don't see unit cost
    const owners = await json<Product[]>(await call('/products', { token: owner }))
    expect(owners.find((p) => p.id === 'p001')).toMatchObject({ cost: demo.products[0]!.cost })
    expect((await call('/products')).status).toBe(401)
  })

  it('looks up a variant by barcode', async () => {
    const { token } = await login(CASHIER)
    const v = demo.variants[0]!
    const res = await json<{ variant: Variant; product: Product }>(await call(`/variants/barcode/${v.barcode}`, { token }))
    expect(res.variant.id).toBe(v.id)
    expect(res.product.id).toBe(v.productId)
    expect((await call('/variants/barcode/8904821999990', { token })).status).toBe(404)
    expect((await call('/variants/barcode/abc', { token })).status).toBe(400)
  })
})

describe('add product', () => {
  it('creates the colour × size grid with unique SKUs, valid EAN-13s and opening store stock', async () => {
    const { token } = await login(PURCHASE)
    const res = await call('/products', { body: newProduct, token })
    expect(res.status).toBe(201)
    const { product, variants } = await json<{ product: Product; variants: Variant[] }>(res)

    expect(product).toMatchObject({ id: `p0${demo.products.length + 1}`, mrp: 1499 }) // numbering continues; MRP never below price
    expect(variants.map((v) => v.id)).toEqual(['ET-055-NEO-M', 'ET-055-NEO-L', 'ET-055-NEO2-M', 'ET-055-NEO2-L']) // duplicate colour dropped
    expect(variants.every((v) => v.stockOffline === 4 && v.stockOnline === 0)).toBe(true)
    for (const v of variants) expect(ean13(v.barcode.slice(0, 12))).toBe(v.barcode)
    expect(variants[0]!.barcode.slice(7, 12)).toBe(String(demo.variants.length + 1).padStart(5, '0'))

    const all = await json<Variant[]>(await call('/variants', { token }))
    expect(new Set(all.map((v) => v.barcode)).size).toBe(all.length)
  })

  it('rejects bad input, unknown suppliers and users without inventory', async () => {
    expect((await call('/products', { body: { ...newProduct, price: 0 }, token: owner })).status).toBe(400)
    expect((await call('/products', { body: { ...newProduct, colors: [] }, token: owner })).status).toBe(400)
    expect((await call('/products', { body: { ...newProduct, category: 'Hats' }, token: owner })).status).toBe(400)
    const unknown = await call('/products', { body: { ...newProduct, supplierId: 'nope' }, token: owner })
    expect(unknown.status).toBe(400)
    expect((await json<{ error: { code: string } }>(unknown)).error.code).toBe('unknown_supplier')
    expect((await call('/products', { body: newProduct, token: (await login(CASHIER)).token })).status).toBe(403)
  })
})

describe('suppliers', () => {
  it('lists for purchase staff, hidden from cashiers', async () => {
    const list = await json<{ id: string }[]>(await call('/suppliers', { token: (await login(PURCHASE)).token }))
    expect(list).toHaveLength(demo.suppliers.length)
    expect((await call('/suppliers', { token: (await login(CASHIER)).token })).status).toBe(403)
  })

  it('adds a supplier with optional phone/GSTIN; a given GSTIN must be valid', async () => {
    const base = { name: 'Erode Cottons', city: 'Erode', state: 'Tamil Nadu' }
    const a = await call('/suppliers', { body: { ...base, phone: '', gstin: '' }, token: owner })
    expect(a.status).toBe(201)
    expect(await json(a)).toMatchObject({ id: `sup${demo.suppliers.length + 1}`, gstin: '' })

    const b = await call('/suppliers', { body: { ...base, gstin: '33aaccT5678L1z2' }, token: owner })
    expect(await json(b)).toMatchObject({ gstin: '33AACCT5678L1Z2' })
    expect((await call('/suppliers', { body: { ...base, gstin: 'BAD' }, token: owner })).status).toBe(400)
    expect((await call('/suppliers', { body: { name: 'X' }, token: owner })).status).toBe(400)
  })
})
