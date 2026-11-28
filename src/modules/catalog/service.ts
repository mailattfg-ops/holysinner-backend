import { asc, eq } from 'drizzle-orm'
import type { z } from 'zod'
import { db } from '../../db'
import { products, suppliers, variants } from '../../db/schema'
import { audit } from '../../lib/audit'
import type { UserRow } from '../../lib/auth'
import { reserve } from '../../lib/counters'
import { applyMoves } from '../../lib/stock'
import { AppError, notFound } from '../../lib/errors'
import { ean13, variantSkus } from '../../shared/billing'
import type { productCreate, supplierInput } from '../../shared/schemas'

export const BARCODE_PREFIX = '8904821' // 890 = India (GS1) + shop code; 5-digit running number follows
const pad = (n: number, w: number) => String(n).padStart(w, '0')

export const listSuppliers = () => db.select().from(suppliers).orderBy(asc(suppliers.name))
export const listProducts = () => db.select().from(products).orderBy(asc(products.id))
export const listVariants = () => db.select().from(variants).orderBy(asc(variants.id))

export function addSupplier(by: UserRow, input: z.infer<typeof supplierInput>) {
  return db.transaction(async (tx) => {
    const [s] = await tx.insert(suppliers).values({ ...input, id: `sup${await reserve(tx, 'supplier')}` }).returning()
    await audit(tx, { userId: by.id, action: 'Supplier added', detail: `${s!.name}, ${s!.city}`, entity: 'supplier', entityId: s!.id })
    return s!
  })
}

// Creates the product and its colour × size variant grid with SKUs and EAN-13 barcodes, in one transaction.
// Opening store stock goes through the ledger as an 'opening' movement per variant.
export function addProduct(by: UserRow, input: z.infer<typeof productCreate>) {
  const { sizes, colors, stock, ...p } = input
  return db.transaction(async (tx) => {
    const [sup] = await tx.select({ id: suppliers.id }).from(suppliers).where(eq(suppliers.id, p.supplierId))
    if (!sup) throw new AppError('unknown_supplier', 'Pick a supplier from the list')

    const n = await reserve(tx, 'product')
    const skus = variantSkus(p.category, n, colors, sizes)
    const firstBarcode = await reserve(tx, 'barcode', skus.length)
    const [product] = await tx.insert(products).values({ ...p, id: `p${pad(n, 3)}`, hue: Math.floor(Math.random() * 360) }).returning()
    const rows = await tx.insert(variants).values(skus.map(({ sku, color, size }, i) => ({
      id: sku, productId: product!.id, size, color,
      barcode: ean13(BARCODE_PREFIX + pad(firstBarcode + i, 5)),
      reorderLevel: 3,
    }))).returning()
    const stocked = stock > 0
      ? await applyMoves(tx, by.id, rows.map((v) => ({ variantId: v.id, channel: 'store' as const, qty: stock, kind: 'opening' as const })))
      : undefined
    await audit(tx, { userId: by.id, action: 'Product added', detail: `${product!.name} · ${rows.length} variants`, entity: 'product', entityId: product!.id })
    return { product: product!, variants: rows.map((v) => stocked?.get(v.id) ?? v) }
  })
}

export async function findByBarcode(code: string) {
  const [row] = await db.select({ variant: variants, product: products }).from(variants)
    .innerJoin(products, eq(products.id, variants.productId)).where(eq(variants.barcode, code))
  if (!row) throw notFound(`Item with barcode ${code}`)
  return row
}
