import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { app, onError } from '../src/app'
import { db } from '../src/db'
import { counters } from '../src/db/schema'
import { AppError } from '../src/lib/errors'
import { v } from '../src/lib/validate'

describe('foundation', () => {
  it('health runs a DB query', async () => {
    const res = await app.request('/api/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, db: 'pglite' })
  })

  it('unknown routes return the error shape', async () => {
    const res = await app.request('/api/nope')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: { code: 'not_found', message: 'Route not found' } })
  })

  it('AppError, validation and crashes map to safe JSON', async () => {
    const t = new Hono()
    t.get('/app', () => { throw new AppError('conflict', 'Only 2 left', 409) })
    t.post('/val', v('json', z.object({ qty: z.number().positive() })), (c) => c.json(c.req.valid('json')))
    t.get('/crash', () => { throw new Error('secret internals') })
    t.get('/dup', async () => { await db.insert(counters).values([{ key: 'dup' }, { key: 'dup' }]); return new Response() })
    t.onError(onError)

    const a = await t.request('/app')
    expect(a.status).toBe(409)
    expect(await a.json()).toEqual({ error: { code: 'conflict', message: 'Only 2 left' } })

    const b = await t.request('/val', { method: 'POST', body: JSON.stringify({ qty: -1 }), headers: { 'content-type': 'application/json' } })
    expect(b.status).toBe(400)
    expect(((await b.json()) as { error: { message: string } }).error.message).toMatch(/^qty:/)

    const c = await t.request('/crash')
    expect(c.status).toBe(500)
    expect(JSON.stringify(await c.json())).not.toContain('secret internals')

    const d = await t.request('/dup') // a real unique-index violation from the DB driver
    expect(d.status).toBe(409)
    expect(((await d.json()) as { error: { code: string } }).error.code).toBe('conflict')
  })
})
