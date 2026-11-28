import { asc, eq, inArray } from 'drizzle-orm'
import type { Tx } from '../db'
import { stockMovements, variants, type MovementKind } from '../db/schema'
import type { Channel } from '../shared/types'
import { conflict, notFound } from './errors'

export interface Move { variantId: string; channel: Channel; qty: number; kind: MovementKind; refId?: string; reason?: string }

// The same SKU picked twice (scanned twice at the till, or listed twice in a return) is one line.
export function mergeQty(lines: { variantId: string; qty: number }[]) {
  const qty = new Map<string, number>()
  for (const l of lines) qty.set(l.variantId, (qty.get(l.variantId) ?? 0) + l.qty)
  return [...qty].map(([variantId, n]) => ({ variantId, qty: n }))
}

const COLUMN ={ store: 'stockOffline', online: 'stockOnline' } as const
const WHERE = { store: 'the store', online: 'online' } as const

// The only place variant balances change. Locks the rows (in SKU order, so parallel tills can't deadlock), applies
// the moves, refuses to go below zero and writes one ledger row per move. Returns the new balances by SKU.
export async function applyMoves(tx: Tx, userId: string, moves: Move[]) {
  const ids = [...new Set(moves.map((m) => m.variantId))]
  const rows = await tx.select().from(variants).where(inArray(variants.id, ids)).orderBy(asc(variants.id)).for('update')
  const bySku = new Map(rows.map((r) => [r.id, r]))
  for (const m of moves) {
    const v = bySku.get(m.variantId)
    if (!v) throw notFound(`SKU ${m.variantId}`)
    const key = COLUMN[m.channel]
    if (v[key] + m.qty < 0) throw conflict(`Only ${v[key]} left of ${v.id} in ${WHERE[m.channel]}`)
    v[key] += m.qty
  }
  // Rows are locked until commit, so writing the computed balance is safe.
  for (const v of bySku.values()) {
    await tx.update(variants).set({ stockOffline: v.stockOffline, stockOnline: v.stockOnline }).where(eq(variants.id, v.id))
  }
  await tx.insert(stockMovements).values(moves.map((m) => ({ ...m, userId })))
  return bySku
}
