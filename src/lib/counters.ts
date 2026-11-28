import { sql } from 'drizzle-orm'
import type { Tx } from '../db'
import { counters } from '../db/schema'

// Atomically reserves `n` numbers and returns the first one. The upsert row-locks the counter until the
// transaction ends, so parallel tills get distinct, gapless numbers (and a rollback gives them back).
export async function reserve(tx: Tx, key: string, n = 1) {
  const [row] = await tx.insert(counters).values({ key, value: n })
    .onConflictDoUpdate({ target: counters.key, set: { value: sql`${counters.value} + ${n}` } })
    .returning({ value: counters.value })
  return row!.value - n + 1
}

// Seeding: move a counter forward to at least `value` (never backwards).
export const bumpTo = (tx: Tx, key: string, value: number) =>
  tx.insert(counters).values({ key, value })
    .onConflictDoUpdate({ target: counters.key, set: { value: sql`greatest(${counters.value}, ${value})` } })
