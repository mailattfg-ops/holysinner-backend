import pino from 'pino'
import { db } from '../db'
import { appLogs } from '../db/schema'
import { env } from '../env'

export const log = pino({ level: env.NODE_ENV === 'test' ? 'silent' : 'info' })

// pino for Vercel's live logs + app_logs for history. Never throws: logging must not break a request.
export async function logIssue(level: 'warn' | 'error', source: string, message: string, context?: Record<string, unknown>) {
  log[level]({ source, ...context }, message)
  try {
    await db.insert(appLogs).values({ level, source, message, context })
  } catch (e) {
    log.error({ err: e }, 'app_logs insert failed')
  }
}
