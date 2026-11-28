import { asc, eq } from 'drizzle-orm'
import type { z } from 'zod'
import { db } from '../../db'
import { offers, settings } from '../../db/schema'
import { audit } from '../../lib/audit'
import type { UserRow } from '../../lib/auth'
import { SETTINGS } from '../../shared/seed'
import type { Settings } from '../../shared/types'
import type { offerInput, settingsPatch } from '../../shared/schemas'

// The shop's real details double as defaults, so a fresh database (no demo seed) still bills correctly.
export async function getSettings(): Promise<Settings> {
  const [row] = await db.select().from(settings)
  if (!row) return SETTINGS
  const { id: _id, ...s } = row
  return s
}

export async function updateSettings(by: UserRow, patch: z.infer<typeof settingsPatch>) {
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(settings).values({ ...SETTINGS, ...patch, id: 1 })
      .onConflictDoUpdate({ target: settings.id, set: patch }).returning()
    await audit(tx, { userId: by.id, action: 'Settings updated', detail: Object.keys(patch).join(', '), entity: 'settings' })
    const { id: _id, ...s } = row!
    return s
  })
}

export const listOffers = () => db.select().from(offers).orderBy(asc(offers.code))

export async function upsertOffer(by: UserRow, code: string, input: z.infer<typeof offerInput>) {
  return db.transaction(async (tx) => {
    const [existing] = await tx.select({ code: offers.code }).from(offers).where(eq(offers.code, code))
    const [offer] = await tx.insert(offers).values({ code, ...input })
      .onConflictDoUpdate({ target: offers.code, set: input }).returning()
    const detail = `${code} · ${input.type === 'percent' ? `${input.value}%` : `₹${input.value}`}${input.active ? '' : ' (inactive)'}`
    await audit(tx, { userId: by.id, action: existing ? 'Offer updated' : 'Offer created', detail, entity: 'offer', entityId: code })
    return { offer: offer!, created: !existing }
  })
}
