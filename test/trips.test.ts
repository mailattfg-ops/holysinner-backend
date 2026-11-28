import { beforeAll, describe, expect, it } from 'vitest'
import { seed } from '../src/db/seed'
import { tripCost } from '../src/shared/money'
import { buildSeed } from '../src/shared/seed'
import type { Trip } from '../src/shared/types'
import { call, json, login, OWNER } from './helpers'

const PURCHASE = '9847055555' // u5: trips + purchases
const CASHIER = '9847033333' // no trips
const demo = buildSeed()
let buyer: string
beforeAll(async () => {
  await seed()
  buyer = (await login(PURCHASE)).token
})

type TripOut = Trip & { settled: ReturnType<typeof tripCost> | null; settledAt: string | null }
const errorOf = async (res: Response) => (await json<{ error: { code: string; message: string } }>(res)).error
const go = (path: string, body?: unknown, method = 'POST') => call(`/trips${path}`, { method, body, token: buyer })
const plan = {
  staffId: 'u5', city: 'Jaipur', state: 'Rajasthan', startDate: '2026-12-05T06:30:00.000Z', endDate: '2026-12-09T06:30:00.000Z',
  purpose: '', allowancePerDay: 1200, advance: 15000, tripPayment: 3000,
}
const newTrip = async (over: Record<string, unknown> = {}) => json<TripOut>(await go('', { ...plan, ...over }))

describe('buying trips', () => {
  it('plan → start → expenses → settle, with the totals frozen at settlement', async () => {
    const res = await go('', plan)
    expect(res.status).toBe(201)
    const t = await json<TripOut>(res)
    expect(t).toMatchObject({ id: `t${demo.trips.length + 1}`, status: 'planned', purpose: 'Stock sourcing', expenses: [], settled: null })

    expect((await json<TripOut>(await go(`/${t.id}/start`))).status).toBe('ongoing')
    await go(`/${t.id}/expenses`, { label: 'Train', amount: 4200 })
    await go(`/${t.id}/expenses`, { label: 'Typo', amount: 99999 })
    await go(`/${t.id}/expenses`, { label: 'Hotel', amount: 6000 })
    const trimmed = await json<TripOut>(await go(`/${t.id}/expenses/1`, undefined, 'DELETE'))
    expect(trimmed.expenses).toEqual([{ label: 'Train', amount: 4200 }, { label: 'Hotel', amount: 6000 }])

    const settled = await json<TripOut>(await go(`/${t.id}/settle`))
    // 4 days × 1200 + 10200 expenses + 3000 payment − 15000 advance
    expect(settled).toMatchObject({ status: 'settled', settled: { days: 4, allowance: 4800, expenses: 10200, payment: 3000, total: 18000, balance: 3000 } })
    expect(settled.settled).toEqual(tripCost(settled))
    expect(settled.settledAt).not.toBeNull()

    for (const [path, body, method] of [[`/${t.id}/expenses`, { label: 'Late', amount: 1 }, 'POST'], [`/${t.id}/expenses/0`, undefined, 'DELETE'], [`/${t.id}/settle`, undefined, 'POST'], [`/${t.id}/start`, undefined, 'POST']] as const) {
      const r = await go(path, body, method)
      expect([r.status, (await errorOf(r)).message]).toEqual([409, 'The Jaipur trip is already settled'])
    }
  })

  it('only moves forward: no settling a planned trip, no starting twice', async () => {
    const t = await newTrip({ city: 'Surat', state: 'Gujarat' })
    expect(await errorOf(await go(`/${t.id}/settle`))).toEqual({ code: 'invalid_status', message: 'Start the Surat trip before settling it' })
    await go(`/${t.id}/start`)
    expect((await errorOf(await go(`/${t.id}/start`))).code).toBe('invalid_status')
  })

  it('validates input, staff and access', async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ endDate: '2026-12-01T06:30:00.000Z' }, 'invalid_input'], // ends before it starts
      [{ city: ' ' }, 'invalid_input'],
      [{ allowancePerDay: -1 }, 'invalid_input'],
      [{ startDate: 'tomorrow' }, 'invalid_input'],
      [{ staffId: 'nope' }, 'unknown_staff'],
    ]
    for (const [over, code] of cases) expect((await errorOf(await go('', { ...plan, ...over }))).code).toBe(code)
    expect((await errorOf(await go('/nope/start'))).code).toBe('not_found')
    expect((await errorOf(await go(`/${demo.trips.find((x) => x.status === 'ongoing')!.id}/expenses/99`, undefined, 'DELETE'))).code).toBe('not_found')
    expect((await errorOf(await go(`/${(await newTrip()).id}/expenses`, { label: 'X', amount: 0 }))).code).toBe('invalid_input')
    const cashier = (await login(CASHIER)).token
    expect((await call('/trips', { body: plan, token: cashier })).status).toBe(403)
    expect((await call('/trips', { token: (await login(OWNER)).token })).status).toBe(200)
  })

  it('serves the demo trips, with settled ones frozen', async () => {
    const list = await json<TripOut[]>(await call('/trips', { token: buyer }))
    for (const d of demo.trips) {
      const t = list.find((x) => x.id === d.id)!
      expect(t).toMatchObject({ city: d.city, status: d.status, expenses: d.expenses })
      expect(t.settled).toEqual(d.status === 'settled' ? tripCost(d) : null)
    }
  })

  it('links purchases only to trips that have started', async () => {
    const planned = await newTrip({ city: 'Kolkata', state: 'West Bengal' })
    const body = { billNo: 'KOL/1', supplierId: 'sup1', items: [{ variantId: demo.variants[0]!.id, qty: 1, cost: 100 }] }
    for (const tripId of [planned.id, 'nope']) {
      expect((await errorOf(await call('/purchases', { body: { ...body, tripId }, token: buyer }))).code).toBe('invalid_trip')
    }
    await go(`/${planned.id}/start`)
    const res = await call('/purchases', { body: { ...body, tripId: planned.id }, token: buyer })
    expect(res.status).toBe(201)
    expect((await json<{ purchase: { tripId: string } }>(res)).purchase.tripId).toBe(planned.id)
  })
})
