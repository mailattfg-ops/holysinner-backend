import { AppError } from './errors'

// The shop runs on Indian time; servers run on UTC. Month boundaries and labels must use IST.
const IST = 330 * 60_000

export const istMonth = (d: Date) => toIst(d).toISOString().slice(0, 7) // "2026-11"

// Midnight IST on the 1st of the month `offset` months from `now` (0 = this month, -1 = last month).
export function istMonthStart(offset: number, now = new Date()) {
  const ist = toIst(now)
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth() + offset, 1) - IST)
}

// The same instant moved by the IST offset, so its UTC fields read as Indian date and time.
export const toIst = (d: Date) => new Date(d.getTime() + IST)

// A bill or expense dated more than a day ahead is a typo (a day of slack covers clock and time-zone drift).
export function notInFuture(date: Date, what: string) {
  if (date.getTime() > Date.now() + 86_400_000) throw new AppError('future_date', `The ${what} date is in the future`)
}
