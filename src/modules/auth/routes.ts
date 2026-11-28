import { Hono, type Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { env } from '../../env'
import { ACCESS_TTL_SEC, authenticate, publicUser, type AppEnv, type UserRow } from '../../lib/auth'
import { v } from '../../lib/validate'
import { loginInput } from '../../shared/schemas'
import { login, logout, refresh, REFRESH_DAYS } from './service'

const COOKIE = 'hs_refresh'
// The frontend reaches the API on its own origin (Vercel rewrite in production, the Vite proxy in dev), so the
// cookie is first-party: SameSite=Lax works on iPhone Safari (which blocks cross-site cookies) and other sites
// can't send it, e.g. to log someone out.
const cookieOpts = { httpOnly: true, path: '/api/auth', maxAge: REFRESH_DAYS * 86400, sameSite: 'Lax' as const, secure: env.NODE_ENV === 'production' }

const session = (c: Context, s: { user: UserRow; accessToken: string; refresh: string }) => {
  setCookie(c, COOKIE, s.refresh, cookieOpts)
  return c.json({ accessToken: s.accessToken, expiresIn: ACCESS_TTL_SEC, user: publicUser(s.user) })
}

export const authRoutes = new Hono<AppEnv>()
  .post('/login', v('json', loginInput), async (c) => {
    const { phone, pin } = c.req.valid('json')
    return session(c, await login(phone, pin))
  })
  .post('/refresh', async (c) => session(c, await refresh(getCookie(c, COOKIE))))
  .post('/logout', async (c) => {
    await logout(getCookie(c, COOKIE))
    deleteCookie(c, COOKIE, cookieOpts)
    return c.json({ ok: true })
  })
  .get('/me', authenticate, (c) => c.json({ user: publicUser(c.var.user) }))
