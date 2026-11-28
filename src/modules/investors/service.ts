import { and, asc, eq, gt, inArray, isNotNull, notInArray } from 'drizzle-orm'
import type { z } from 'zod'
import { db, type DB } from '../../db'
import { users } from '../../db/schema'
import { audit } from '../../lib/audit'
import type { UserRow } from '../../lib/auth'
import { AppError } from '../../lib/errors'
import { istMonth, istMonthStart } from '../../lib/ist'
import { splitProfit } from '../../shared/billing'
import { profitAndLoss } from '../../shared/money'
import type { sharesInput } from '../../shared/schemas'
import { pnlData } from '../finance/service'

// Holders in a fixed order (oldest user first): the last one absorbs the rounding in splitProfit.
const listHolders = (ex: DB = db) =>
  ex.select({ id: users.id, name: users.name, role: users.role, sharePct: users.sharePct }).from(users)
    .where(gt(users.sharePct, 0)).orderBy(asc(users.createdAt), asc(users.id))

// Monthly net profit and each holder's cut, for the last `months` IST calendar months (this one included).
// An investor sees only their own row, as on the Investors screen; the owner/managers see everyone.
export async function investorSummary(viewer: UserRow, months: number) {
  const windows = Array.from({ length: months }, (_, i) => ({ from: istMonthStart(i - months + 1), to: istMonthStart(i - months + 2) }))
  const [data, holders] = await Promise.all([pnlData(windows[0]!.from, windows.at(-1)!.to), listHolders()])
  const shares = holders.map((h) => ({ id: h.id, sharePct: h.sharePct! }))
  const visible = <T extends { id: string }>(rows: T[]) => (viewer.role === 'Investor' ? rows.filter((r) => r.id === viewer.id) : rows)
  return {
    holders: visible(holders),
    months: windows.map(({ from, to }) => {
      const p = profitAndLoss(data, from, to)
      return { month: istMonth(from), from: from.toISOString(), to: to.toISOString(), ...p, split: visible(splitProfit(p.netProfit, shares)) }
    }),
  }
}

// Replaces the whole split in one transaction, so the shares always total 100%.
export function setShares(by: UserRow, { shares }: z.infer<typeof sharesInput>) {
  const ids = shares.map((s) => s.userId)
  return db.transaction(async (tx) => {
    const found = await tx.select({ id: users.id, name: users.name }).from(users).where(and(inArray(users.id, ids), eq(users.active, true))).for('update')
    if (found.length !== ids.length) throw new AppError('unknown_user', 'Shares can only go to active users')
    await tx.update(users).set({ sharePct: null }).where(and(isNotNull(users.sharePct), notInArray(users.id, ids)))
    for (const s of shares) await tx.update(users).set({ sharePct: s.sharePct }).where(eq(users.id, s.userId))
    const name = new Map(found.map((u) => [u.id, u.name.split(' ')[0]]))
    await audit(tx, { userId: by.id, action: 'Profit shares updated', detail: shares.map((s) => `${name.get(s.userId)} ${s.sharePct}%`).join(', '), entity: 'shares' })
    return listHolders(tx)
  })
}
