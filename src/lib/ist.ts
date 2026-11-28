// The shop runs on Indian time; servers run on UTC. Month boundaries and labels must use IST.
const IST = 330 * 60_000

export const istMonth = (d: Date) => new Date(d.getTime() + IST).toISOString().slice(0, 7) // "2026-11"

// Midnight IST on the 1st of the month `offset` months from `now` (0 = this month, -1 = last month).
export function istMonthStart(offset: number, now = new Date()) {
  const ist = new Date(now.getTime() + IST)
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth() + offset, 1) - IST)
}
