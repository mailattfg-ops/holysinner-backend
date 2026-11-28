import { beforeAll, describe, expect, it } from 'vitest'
import { seed } from '../src/db/seed'
import { buildSeed } from '../src/shared/seed'
import type { Customer } from '../src/shared/types'
import { call, json, login, OWNER } from './helpers'

const CASHIER = '9847033333' // pos + customers
const PURCHASE = '9847055555' // no customer access
const demo = buildSeed()
let owner: string
beforeAll(async () => {
  await seed()
  owner = (await login(OWNER)).token
})

const anjali = { name: 'Anjali Menon', phone: '+91 70123 45678', city: 'Thrissur', email: 'Anjali@Example.com', birthday: '08-21' }

describe('customer list & search', () => {
  it('serves all demo customers with their loyalty points', async () => {
    const list = await json<Customer[]>(await call('/customers', { token: (await login(CASHIER)).token }))
    expect(list).toHaveLength(demo.customers.length)
    const c1 = demo.customers[0]!
    expect(list.find((c) => c.id === c1.id)).toMatchObject({ phone: c1.phone, loyaltyPoints: c1.loyaltyPoints })
    expect((await call('/customers', { token: (await login(PURCHASE)).token })).status).toBe(403)
  })

  it('searches by phone digits or by name', async () => {
    const c1 = demo.customers[0]!
    const byPhone = await json<Customer[]>(await call(`/customers?q=${encodeURIComponent(c1.phone.slice(2, 8))}`, { token: owner }))
    expect(byPhone.map((c) => c.id)).toContain(c1.id)
    expect(byPhone.every((c) => c.phone.includes(c1.phone.slice(2, 8)))).toBe(true)

    const first = c1.name.split(' ')[0]!
    const byName = await json<Customer[]>(await call(`/customers?q=${first.toLowerCase()}`, { token: owner }))
    expect(byName.length).toBeGreaterThan(0)
    expect(byName.length).toBeLessThanOrEqual(20)
    expect(byName.every((c) => c.name.toLowerCase().includes(first.toLowerCase()))).toBe(true)
    expect(await json(await call('/customers?q=%25', { token: owner }))).toEqual([]) // % is literal, not a wildcard
  })
})

describe('add & edit customers', () => {
  it('lets a cashier add a customer at the till; phone is normalised and unique', async () => {
    const cashier = (await login(CASHIER)).token
    const res = await call('/customers', { body: anjali, token: cashier })
    expect(res.status).toBe(201)
    expect(await json(res)).toMatchObject({
      id: `c${demo.customers.length + 1}`, phone: '7012345678', email: 'anjali@example.com', loyaltyPoints: 0, notes: null,
    })
    const dup = await call('/customers', { body: { ...anjali, name: 'Someone Else', phone: '07012345678' }, token: cashier })
    expect(dup.status).toBe(409)
    expect((await json<{ error: { message: string } }>(dup)).error.message).toBe('7012345678 already belongs to Anjali Menon')
  })

  it('validates phone, email and birthday', async () => {
    for (const bad of [{ phone: '12345' }, { email: 'nope' }, { birthday: '21-08' }, { name: ' ' }]) {
      expect((await call('/customers', { body: { ...anjali, phone: '8012345678', ...bad }, token: owner })).status).toBe(400)
    }
    const minimal = await call('/customers', { body: { name: 'Walk In', phone: '8012345679', email: '', birthday: '' }, token: owner })
    expect(await json(minimal)).toMatchObject({ city: 'Kochi', email: null, birthday: null })
  })

  it('edits details, clears fields with "", and never touches points', async () => {
    const c = demo.customers.find((x) => x.loyaltyPoints > 0 && x.email)!
    const res = await call(`/customers/${c.id}`, { method: 'PATCH', body: { notes: 'Prefers slim fit', email: '', loyaltyPoints: 99999 }, token: owner })
    expect(res.status).toBe(200)
    expect(await json(res)).toMatchObject({ notes: 'Prefers slim fit', email: null, loyaltyPoints: c.loyaltyPoints })
    expect((await call(`/customers/${c.id}`, { method: 'PATCH', body: { loyaltyPoints: 5 }, token: owner })).status).toBe(400)
  })

  it('rejects a phone taken by someone else, unknown ids, and edits without the customers module', async () => {
    const [a, b] = demo.customers
    expect((await call(`/customers/${a!.id}`, { method: 'PATCH', body: { phone: b!.phone }, token: owner })).status).toBe(409)
    expect((await call(`/customers/${a!.id}`, { method: 'PATCH', body: { phone: a!.phone }, token: owner })).status).toBe(200) // own phone is fine
    expect((await call('/customers/c999999', { method: 'PATCH', body: { name: 'X' }, token: owner })).status).toBe(404)
    expect((await call(`/customers/${a!.id}`, { method: 'PATCH', body: { name: 'X' }, token: (await login(PURCHASE)).token })).status).toBe(403)
  })
})
