import { asc, desc, eq, ilike, like } from 'drizzle-orm'
import type { z } from 'zod'
import { db } from '../../db'
import { customers } from '../../db/schema'
import { audit } from '../../lib/audit'
import type { UserRow } from '../../lib/auth'
import { reserve } from '../../lib/counters'
import { conflict, notFound } from '../../lib/errors'
import type { customerInput, customerPatch } from '../../shared/schemas'

const SEARCH_LIMIT = 20
const escapeLike = (s: string) => s.replace(/[\\%_]/g, '\\$&') // so a typed % or _ matches itself

// No query: the full list, newest first (the Customers page). With a query: 3+ digits search the phone, else the name.
export function listCustomers(q?: string) {
  if (!q) return db.select().from(customers).orderBy(desc(customers.createdAt), desc(customers.id))
  const digits = q.replace(/\D/g, '')
  const where = digits.length >= 3 ? like(customers.phone, `%${digits}%`) : ilike(customers.name, `%${escapeLike(q)}%`)
  return db.select().from(customers).where(where).orderBy(asc(customers.name)).limit(SEARCH_LIMIT)
}

async function phoneFree(phone: string, exceptId?: string) {
  const [dup] = await db.select({ id: customers.id, name: customers.name }).from(customers).where(eq(customers.phone, phone))
  if (dup && dup.id !== exceptId) throw conflict(`${phone} already belongs to ${dup.name}`)
}

export async function addCustomer(by: UserRow, input: z.infer<typeof customerInput>) {
  await phoneFree(input.phone)
  return db.transaction(async (tx) => {
    const [c] = await tx.insert(customers).values({ ...input, id: `c${await reserve(tx, 'customer')}` }).returning()
    await audit(tx, { userId: by.id, action: 'Customer added', detail: c!.name, entity: 'customer', entityId: c!.id })
    return c!
  })
}

export async function updateCustomer(by: UserRow, id: string, patch: z.infer<typeof customerPatch>) {
  if (patch.phone) await phoneFree(patch.phone, id)
  return db.transaction(async (tx) => {
    const [c] = await tx.update(customers).set(patch).where(eq(customers.id, id)).returning()
    if (!c) throw notFound('Customer')
    await audit(tx, { userId: by.id, action: 'Customer updated', detail: c.name, entity: 'customer', entityId: id })
    return c
  })
}
