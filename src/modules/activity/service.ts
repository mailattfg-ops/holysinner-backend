import { and, desc, inArray } from 'drizzle-orm'
import { db } from '../../db'
import { auditLog } from '../../db/schema'
import { ACTION_MODULE } from '../../lib/access'
import type { UserRow } from '../../lib/auth'
import type { AuditEntry } from '../../shared/types'

// The owner sees everything; others see the actions of the modules they have (see ACTION_MODULE).
const actionsFor = (viewer: UserRow) =>
  viewer.role === 'Owner' ? undefined : Object.entries(ACTION_MODULE).filter(([, m]) => viewer.modules.includes(m)).map(([a]) => a)

export async function listActivity(viewer: UserRow, limit: number): Promise<AuditEntry[]> {
  const actions = actionsFor(viewer)
  if (actions && !actions.length) return []
  const rows = await db.select().from(auditLog).where(and(actions && inArray(auditLog.action, actions)))
    .orderBy(desc(auditLog.at), desc(auditLog.id)).limit(limit)
  return rows.map((r) => ({ id: String(r.id), date: r.at.toISOString(), userId: r.userId ?? '', action: r.action, detail: r.detail }))
}
