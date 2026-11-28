import { and, desc, eq, lt } from 'drizzle-orm'
import type { z } from 'zod'
import { db } from '../../db'
import { stockMovements } from '../../db/schema'
import { audit } from '../../lib/audit'
import type { UserRow } from '../../lib/auth'
import { reserve } from '../../lib/counters'
import { applyMoves } from '../../lib/stock'
import type { stockAdjust, stockTransfer } from '../../shared/schemas'
import type { Channel, Transfer } from '../../shared/types'

const route = (from: Channel) => (from === 'store' ? 'Store → Online' : 'Online → Store')

export function adjustStock(by: UserRow, { variantId, channel, delta, reason }: z.infer<typeof stockAdjust>) {
  return db.transaction(async (tx) => {
    const variant = (await applyMoves(tx, by.id, [{ variantId, channel, qty: delta, kind: 'adjust', reason }])).get(variantId)!
    const signed = delta > 0 ? `+${delta}` : String(delta)
    await audit(tx, { userId: by.id, action: 'Stock adjusted', detail: `${variantId} · ${channel} ${signed} (${reason})`, entity: 'variant', entityId: variantId })
    return variant
  })
}

// A transfer is two ledger rows sharing one id: the "from" leg (−qty) and the "to" leg (+qty).
export function transferStock(by: UserRow, { variantId, qty, from }: z.infer<typeof stockTransfer>) {
  return db.transaction(async (tx) => {
    const refId = `tr${await reserve(tx, 'transfer')}`
    const to: Channel = from === 'store' ? 'online' : 'store'
    const variant = (await applyMoves(tx, by.id, [
      { variantId, channel: from, qty: -qty, kind: 'transfer', refId },
      { variantId, channel: to, qty, kind: 'transfer', refId },
    ])).get(variantId)!
    await audit(tx, { userId: by.id, action: 'Stock transfer', detail: `${qty} pcs ${route(from)} · ${variantId}`, entity: 'variant', entityId: variantId })
    const transfer: Transfer = { id: refId, date: new Date().toISOString(), variantId, qty, from, userId: by.id }
    return { transfer, variant }
  })
}

// The Transfers tab, newest first, in the frontend's Transfer shape (read from each transfer's "from" leg).
export async function listTransfers(): Promise<Transfer[]> {
  const legs = await db.select().from(stockMovements)
    .where(and(eq(stockMovements.kind, 'transfer'), lt(stockMovements.qty, 0)))
    .orderBy(desc(stockMovements.at), desc(stockMovements.id))
  return legs.map((m) => ({ id: m.refId!, date: m.at.toISOString(), variantId: m.variantId, qty: -m.qty, from: m.channel, userId: m.userId ?? '' }))
}
