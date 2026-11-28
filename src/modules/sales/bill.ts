import type { Payment } from '../../db/schema'
import { AppError } from '../../lib/errors'
import { computeBill, round2 } from '../../shared/billing'
import type { Offer, SaleItem, Settings } from '../../shared/types'

const two = (n: number) => String(n % 100).padStart(2, '0')

// Financial year label for an invoice, in Indian time: 1 April 2026 IST onwards → "26-27".
export function financialYear(d: Date) {
  const ist = new Date(d.getTime() + 330 * 60_000)
  const start = ist.getUTCMonth() >= 3 ? ist.getUTCFullYear() : ist.getUTCFullYear() - 1
  return `${two(start)}-${two(start + 1)}`
}

interface BillInput { manualDiscount: number; pointsToRedeem: number; interState: boolean }

// Same steps as the POS screen (useBill): price the cart, then redeem as many of the requested points as still fit.
export function priceBill(items: SaleItem[], offer: Offer | undefined, input: BillInput, pointsBalance: number, s: Settings) {
  if (input.pointsToRedeem > pointsBalance) throw new AppError('not_enough_points', `Only ${pointsBalance} points available`)
  const pre = computeBill(items, { offer, manualDiscount: input.manualDiscount })
  const pointsUsed = Math.min(input.pointsToRedeem, Math.floor((pre.subtotal - pre.offerDiscount - pre.manualDiscount) / s.pointValue))
  const bill = computeBill(items, { offer, manualDiscount: input.manualDiscount, pointsRedeemed: pointsUsed * s.pointValue, interState: input.interState })
  return { bill, pointsUsed }
}

// Payments must cover the bill exactly (change is the till's business). Returns the credit-note part.
export function checkPayments(payments: Payment[], total: number, creditNoteNo?: string) {
  const paid = round2(payments.reduce((t, p) => t + p.amount, 0))
  if (paid !== total) throw new AppError('payment_mismatch', `Payments add up to ₹${paid}, but the bill is ₹${total}`)
  const cn = payments.filter((p) => p.mode === 'credit-note')
  if (cn.length > 1) throw new AppError('invalid_payment', 'Use one credit note per bill')
  if (cn.length && !creditNoteNo) throw new AppError('invalid_payment', 'Enter the credit note number')
  return cn[0]?.amount ?? 0
}
