import { app } from '../src/app'
import { DEMO_PIN } from '../src/db/seed'

// Demo users from shared/seed.ts
export const OWNER = '9847011111' // u1 Arjun, all modules
export const MANAGER = '9847022222' // u2, no 'users' module

interface Opts { method?: string; body?: unknown; token?: string; cookie?: string }

export const call = (path: string, { method, body, token, cookie }: Opts = {}) =>
  app.request(`/api${path}`, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: {
      ...(body !== undefined && { 'content-type': 'application/json' }),
      ...(token && { authorization: `Bearer ${token}` }),
      ...(cookie && { cookie }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

export const cookieOf = (res: Response) => res.headers.get('set-cookie')?.split(';')[0] ?? ''

export async function login(phone: string, pin = DEMO_PIN) {
  const res = await call('/auth/login', { body: { phone, pin } })
  if (res.status !== 200) throw new Error(`login ${phone} failed: ${res.status} ${await res.text()}`)
  const json = (await res.json()) as { accessToken: string; user: { id: string } }
  return { token: json.accessToken, user: json.user, cookie: cookieOf(res) }
}

export const json = async <T = Record<string, unknown>>(res: Response) => (await res.json()) as T
