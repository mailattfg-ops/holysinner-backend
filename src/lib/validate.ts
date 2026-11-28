import { zValidator } from '@hono/zod-validator'
import type { ValidationTargets } from 'hono'
import type { z } from 'zod'
import { AppError } from './errors'

// zValidator with our error shape: the first issue becomes a user-facing message, prefixed with the field
// it's about. Whole-form rules ("Shares must add up to exactly 100%") have no field, so no prefix.
export const v = <T extends z.ZodType, K extends keyof ValidationTargets>(target: K, schema: T) =>
  zValidator(target, schema, (r) => {
    if (r.success) return
    const i = r.error.issues[0]
    const field = i?.path.join('.')
    throw new AppError('invalid_input', i ? (field ? `${field}: ${i.message}` : i.message) : 'Invalid input')
  })
