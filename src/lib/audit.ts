import type { Tx } from '../db'
import { auditLog } from '../db/schema'

export interface AuditInput { userId?: string; action: string; detail: string; entity?: string; entityId?: string }

// Call inside the same transaction as the change it describes.
export const audit = (tx: Tx, a: AuditInput) => tx.insert(auditLog).values(a)
