// Port of frontend/src/lib/billing.check.ts — the shared math must give identical results on the server.
import { expect, it } from 'vitest'
import { computeBill, ean13, gstRateFor, splitProfit } from '../src/shared/billing'

it('GST slabs', () => {
  expect(gstRateFor(2500)).toBe(5)
  expect(gstRateFor(2501)).toBe(18)
})

it('tax backed out of inclusive prices, CGST/SGST split', () => {
  const a = computeBill([{ price: 1050, qty: 1, gstRate: 5 }])
  expect([a.taxable, a.cgst, a.sgst, a.total]).toEqual([1000, 25, 25, 1050])
})

it('offer discount spreads before tax', () => {
  const b = computeBill([{ price: 1050, qty: 2, gstRate: 5 }], { offer: { code: 'X', type: 'percent', value: 10, minBill: 0, active: true, description: '' } })
  expect([b.offerDiscount, b.total, b.taxTotal]).toEqual([210, 1890, 90])
})

it('inter-state is IGST only, mixed slabs', () => {
  const c = computeBill([{ price: 1050, qty: 1, gstRate: 5 }, { price: 3540, qty: 1, gstRate: 18 }], { interState: true })
  expect([c.igst, c.cgst, c.total]).toEqual([590, 0, 4590])
})

it('offer below minBill ignored; discounts never exceed subtotal', () => {
  const d = computeBill([{ price: 500, qty: 1, gstRate: 5 }], {
    offer: { code: 'Y', type: 'flat', value: 300, minBill: 1000, active: true, description: '' }, manualDiscount: 9999,
  })
  expect([d.offerDiscount, d.total]).toEqual([0, 0])
})

it('profit split sums to net; EAN-13 check digit', () => {
  const s = splitProfit(100000.01, [{ id: 'a', sharePct: 50 }, { id: 'b', sharePct: 30 }, { id: 'c', sharePct: 20 }])
  expect(s.map((x) => x.amount)).toEqual([50000.01, 30000, 20000])
  expect(ean13('400638133393')).toBe('4006381333931')
})
