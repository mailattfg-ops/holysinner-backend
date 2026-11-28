import type { ContentfulStatusCode } from 'hono/utils/http-status'

// Thrown anywhere; app.onError turns it into { error: { code, message } }. Messages must be safe to show users.
export class AppError extends Error {
  constructor(public code: string, message: string, public status: ContentfulStatusCode = 400) {
    super(message)
  }
}

export const notFound = (what: string) => new AppError('not_found', `${what} not found`, 404)
export const forbidden = (message = 'You do not have access to this') => new AppError('forbidden', message, 403)
export const unauthorized = (message = 'Please log in again') => new AppError('unauthorized', message, 401)
export const conflict = (message: string) => new AppError('conflict', message, 409)
