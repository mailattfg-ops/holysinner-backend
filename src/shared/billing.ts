import type { Offer, ReturnEntry, Sale } from './types'

// GST on apparel & footwear (Sept 2025 slabs): ≤ ₹2500 per piece → 5%, above → 18%
export const gstRateFor = (unitPrice: number) => (unitPrice <= 2500 ? 5 : 18)

export const round2 = (n: number) => Math.round(n * 100) / 100

export interface BillLine { price: number; qty: number; gstRate: number }

export interface BillOpts {
  manualDiscount?: number // flat ₹
  offer?: Offer
  pointsRedeemed?: number // ₹ value
  interState?: boolean
}

export interface BillTotals {
  subtotal: number
  offerDiscount: number
  manualDiscount: number
  pointsRedeemed: number
  discount: number // offer + manual (excludes points: points are a payment-like reduction)
  taxable: number
  cgst: number
  sgst: number
  igst: number
  taxTotal: number
  roundOff: number
  total: number
  slabs: { rate: number; taxable: number; tax: number }[]
}

export function offerDiscountFor(offer: Offer | undefined, subtotal: number) {
  if (!offer || !offer.active || subtotal < offer.minBill) return 0
  return round2(offer.type === 'percent' ? (subtotal * offer.value) / 100 : Math.min(offer.value, subtotal))
}

// Prices are GST-inclusive. Discounts are spread across lines pro-rata, then tax is backed out per slab.
export function computeBill(lines: BillLine[], opts: BillOpts = {}): BillTotals {
  const subtotal = round2(lines.reduce((s, l) => s + l.price * l.qty, 0))
  const offerDiscount = offerDiscountFor(opts.offer, subtotal)
  const manualDiscount = Math.min(opts.manualDiscount ?? 0, subtotal - offerDiscount)
  const pointsRedeemed = Math.min(opts.pointsRedeemed ?? 0, subtotal - offerDiscount - manualDiscount)
  const reduction = offerDiscount + manualDiscount + pointsRedeemed
  const factor = subtotal ? (subtotal - reduction) / subtotal : 0

  const bySlab = new Map<number, number>()
  for (const l of lines) bySlab.set(l.gstRate, (bySlab.get(l.gstRate) ?? 0) + l.price * l.qty * factor)
  const slabs = [...bySlab].map(([rate, gross]) => {
    const taxable = round2(gross / (1 + rate / 100))
    return { rate, taxable, tax: round2(gross - taxable) }
  })
  const taxTotal = round2(slabs.reduce((s, x) => s + x.tax, 0))
  const taxable = round2(slabs.reduce((s, x) => s + x.taxable, 0))
  const exact = round2(subtotal - reduction)
  const total = Math.round(exact)
  const half = round2(taxTotal / 2)
  return {
    subtotal, offerDiscount, manualDiscount, pointsRedeemed,
    discount: round2(offerDiscount + manualDiscount),
    taxable,
    cgst: opts.interState ? 0 : half,
    sgst: opts.interState ? 0 : round2(taxTotal - half),
    igst: opts.interState ? taxTotal : 0,
    taxTotal, roundOff: round2(total - exact), total, slabs,
  }
}

export const pointsEarned = (total: number, per100: number) => Math.floor(total / 100) * per100

// Points a bill can take: no more than wanted, nor than the ₹ left after the offer and manual discount.
// A point value of 0 means redemption is off (dividing by it would take every point for ₹0).
export const redeemablePoints = (wanted: number, rupeesLeft: number, pointValue: number) =>
  pointValue > 0 ? Math.max(0, Math.min(wanted, Math.floor(rupeesLeft / pointValue))) : 0

// A returned line refunds what was actually paid for it: its share of the bill after every discount.
export const returnLineAmount = (price: number, qty: number, sale: { total: number; subtotal: number }) =>
  Math.round(price * qty * (sale.subtotal ? sale.total / sale.subtotal : 1))

// What each line of a return refunds. Lines are rounded one by one, so on a discounted bill they can add up to
// more than was paid (10 × ₹99 less ₹5 = ₹985, returned singly = 10 × ₹99). The bill's refunds never pass its
// total: the excess comes off the biggest line.
export function returnAmounts(lines: { price: number; qty: number }[], sale: { total: number; subtotal: number }, refundedBefore: number) {
  const amounts = lines.map((l) => returnLineAmount(l.price, l.qty, sale))
  const over = amounts.reduce((t, a) => t + a, 0) - Math.max(0, sale.total - refundedBefore)
  if (over > 0 && amounts.length) {
    const i = amounts.indexOf(Math.max(...amounts))
    amounts[i] = Math.max(0, amounts[i]! - over)
  }
  return amounts
}

// A supplier payment settles the oldest unpaid bills first (FIFO). Anything beyond the total due is not allocated.
export function allocateFifo(bills: { id: string; date: string; total: number; paid: number }[], amount: number) {
  let left = round2(amount)
  return [...bills].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)).flatMap((b) => {
    const pay = round2(Math.min(left, b.total - b.paid))
    if (pay <= 0) return []
    left = round2(left - pay)
    return [{ purchaseId: b.id, amount: pay }]
  })
}

// Splits net profit by share %; last holder absorbs rounding so the parts always sum to the whole.
// The last holder absorbs the rounding only when the list is the whole split (100%). An investor's screen gets
// just their own share, and must not be handed everyone else's profit as "rounding".
export function splitProfit(net: number, holders: { id: string; sharePct: number }[]) {
  const whole = Math.round(holders.reduce((t, h) => t + h.sharePct, 0) * 100) === 10_000
  let given = 0
  return holders.map((h, i) => {
    const amount = whole && i === holders.length - 1 ? round2(net - given) : round2((net * h.sharePct) / 100)
    given += amount
    return { id: h.id, sharePct: h.sharePct, amount }
  })
}

// EAN-13 check digit
export function ean13(base12: string) {
  const sum = base12.split('').reduce((s, d, i) => s + Number(d) * (i % 2 ? 3 : 1), 0)
  return base12 + ((10 - (sum % 10)) % 10)
}

// Variant SKUs: <CAT>-<product no>-<COLOUR>-<size>, colours × sizes in that order.
// Colours sharing their first 3 letters (Neon Green / Neon Pink, White / White/Navy) get a digit so SKUs stay unique.
export function variantSkus(category: string, productNo: number, colors: string[], sizes: string[]) {
  const used = new Set<string>()
  const codes = colors.map((c) => {
    const base = c.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase()
    let code = base
    for (let i = 2; used.has(code); i++) code = `${base}${i}`
    used.add(code)
    return code
  })
  const prefix = `${category.slice(0, 2).toUpperCase()}-${String(productNo).padStart(3, '0')}`
  return colors.flatMap((color, ci) => sizes.map((size) => ({ sku: `${prefix}-${codes[ci]}-${size.replace(/\s/g, '')}`, color, size })))
}

// ---------- GST returns (GSTR-1)
// A period reports its invoices as issued, in full. Goods returned later are subtracted in the period of the
// return, so a month's figures never change after it has been filed.
interface GstLine { productId: string; rate: number; qty: number; gross: number; interState: boolean }

// Each invoice line at what the bill charged: its share after the offer, manual and points reductions, as in computeBill.
const invoiceLines = (sale: Sale): GstLine[] => {
  const factor = sale.subtotal ? (sale.subtotal - sale.discount - sale.pointsRedeemed) / sale.subtotal : 0
  return sale.items.map((i) => ({ productId: i.productId, rate: i.gstRate, qty: i.qty, gross: i.price * i.qty * factor, interState: sale.interState }))
}

// A return takes back its refund amount at the rate of the line it came from (negative, so it nets off).
const returnLines = ({ entry, sale }: GstReturnInput): GstLine[] => entry.items.map((x) => {
  const item = sale.items.find((i) => i.variantId === x.variantId)!
  return { productId: item.productId, rate: item.gstRate, qty: -x.qty, gross: -x.amount, interState: sale.interState }
})

export interface GstReturnInput { entry: ReturnEntry; sale: Sale }
export interface GstAmounts { taxable: number; cgst: number; sgst: number; igst: number }
export interface GstReport {
  hsn: (GstAmounts & { hsn: string; rate: number; qty: number })[] // table 12: HSN-wise summary
  b2cs: (GstAmounts & { supply: 'Intra-state' | 'Inter-state'; rate: number })[] // table 7: B2C (small), by supply and rate
  documents: { series: string; first: string; last: string; count: number }[] // table 13: invoices and credit notes issued
  totals: GstAmounts
}

const zero = (): GstAmounts => ({ taxable: 0, cgst: 0, sgst: 0, igst: 0 })
const addTo = (row: GstAmounts, l: GstLine) => {
  const taxable = l.gross / (1 + l.rate / 100)
  const tax = l.gross - taxable
  row.taxable += taxable
  if (l.interState) row.igst += tax; else { row.cgst += tax / 2; row.sgst += tax / 2 }
}
const rowFor = <T>(rows: Map<string, T>, key: string, make: () => T) => rows.get(key) ?? rows.set(key, make()).get(key)!
const rounded = <T extends GstAmounts>(r: T): T => ({ ...r, taxable: round2(r.taxable), cgst: round2(r.cgst), sgst: round2(r.sgst), igst: round2(r.igst) })

// Document series: the number minus its running digits (HS/26-27/, #SHP, CN-), first and last by number.
function documentSeries(numbers: string[]) {
  const bySeries = new Map<string, GstReport['documents'][number]>()
  for (const no of [...numbers].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))) {
    const series = no.replace(/\d+$/, '')
    const s = bySeries.get(series)
    if (s) { s.last = no; s.count++ } else bySeries.set(series, { series, first: no, last: no, count: 1 })
  }
  return [...bySeries.values()]
}

// sales: invoices dated in the period. returns: returns dated in the period, each with the bill it came from.
export function gstReport(sales: Sale[], returns: GstReturnInput[], hsnOf: (productId: string) => string): GstReport {
  const hsn = new Map<string, GstReport['hsn'][number]>()
  const b2cs = new Map<string, GstReport['b2cs'][number]>()
  const totals = zero()
  for (const l of [...sales.flatMap(invoiceLines), ...returns.flatMap(returnLines)]) {
    const code = hsnOf(l.productId)
    const supply = l.interState ? 'Inter-state' : 'Intra-state'
    const h = rowFor(hsn, `${code}|${l.rate}`, () => ({ hsn: code, rate: l.rate, qty: 0, ...zero() }))
    const b = rowFor(b2cs, `${supply}|${l.rate}`, () => ({ supply, rate: l.rate, ...zero() }))
    h.qty += l.qty
    for (const row of [h, b, totals]) addTo(row, l)
  }
  const byRate = <T extends { rate: number }>(a: T, b: T) => a.rate - b.rate
  return {
    hsn: [...hsn.values()].map(rounded).sort((a, b) => a.hsn.localeCompare(b.hsn) || byRate(a, b)),
    b2cs: [...b2cs.values()].map(rounded).sort((a, b) => a.supply.localeCompare(b.supply) || byRate(a, b)),
    documents: documentSeries([...sales.map((s) => s.invoiceNo), ...returns.flatMap((r) => r.entry.creditNoteNo ?? [])]),
    totals: rounded(totals),
  }
}

// The report as CSV-ready tables for the accountant (same columns on screen, in the download and from the API).
export function gstTables(r: GstReport, shopState: string) {
  const tax = (x: GstAmounts) => [x.taxable, x.cgst, x.sgst, x.igst, round2(x.cgst + x.sgst + x.igst)]
  const money = ['Taxable value (₹)', 'CGST (₹)', 'SGST (₹)', 'IGST (₹)', 'Total tax (₹)']
  return {
    hsn: { columns: ['HSN', 'GST %', 'Qty', ...money], rows: r.hsn.map((x) => [x.hsn, x.rate, x.qty, ...tax(x)]) },
    b2cs: {
      columns: ['Supply', 'Place of supply', 'GST %', ...money],
      rows: r.b2cs.map((x) => [x.supply, x.supply === 'Intra-state' ? shopState : 'Other state (not recorded)', x.rate, ...tax(x)]),
    },
    documents: { columns: ['Series', 'From', 'To', 'Count'], rows: r.documents.map((d) => [d.series, d.first, d.last, d.count]) },
  }
}
