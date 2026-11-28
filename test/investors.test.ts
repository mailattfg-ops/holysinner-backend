import { beforeAll, describe, expect, it } from 'vitest'
import { seed } from '../src/db/seed'
import { istMonth, istMonthStart } from '../src/lib/ist'
import { splitProfit } from '../src/shared/billing'
import { profitAndLoss } from '../src/shared/money'
import { buildSeed } from '../src/shared/seed'
import { call, json, login, MANAGER, OWNER } from './helpers'

const INVESTOR = '9847066666' // u6, 30%
const CASHIER = '9847033333'
const demo = buildSeed()
let owner: string
beforeAll(async () => {
  await seed()
  owner = (await login(OWNER)).token
})

interface Split { id: string; sharePct: number; amount: number }
interface Summary { holders: { id: string; sharePct: number }[]; months: { month: string; netProfit: number; split: Split[] }[] }
const errorOf = async (res: Response) => (await json<{ error: { code: string; message: string } }>(res)).error
const summary = async (token = owner, q = '') => json<Summary>(await call(`/investors/summary${q}`, { token }))
const setShares = (shares: { userId: string; sharePct: number }[], token = owner) => call('/investors/shares', { method: 'PUT', body: { shares }, token })
const demoShares = demo.users.filter((u) => u.sharePct).map((u) => ({ id: u.id, sharePct: u.sharePct! }))

describe('investor summary', () => {
  it('splits each IST month’s net profit like the Investors screen, the last holder absorbing rounding', async () => {
    const s = await summary()
    expect(s.holders.map((h) => [h.id, h.sharePct])).toEqual(demoShares.map((h) => [h.id, h.sharePct]))
    expect(s.months.map((m) => m.month)).toEqual(Array.from({ length: 6 }, (_, i) => istMonth(istMonthStart(i - 5))))
    s.months.forEach((m, i) => {
      const want = profitAndLoss(demo, istMonthStart(i - 5), istMonthStart(i - 4)).netProfit
      expect(m.netProfit).toBeCloseTo(want, 2)
      expect(m.split).toEqual(splitProfit(m.netProfit, demoShares))
      expect(m.split.reduce((t, x) => t + x.amount, 0)).toBeCloseTo(m.netProfit, 2)
    })
    expect((await summary(owner, '?months=12')).months).toHaveLength(12)
    expect((await call('/investors/summary?months=0', { token: owner })).status).toBe(400)
  })

  it('shows an investor only their own share, and hides it from users without the module', async () => {
    const s = await summary((await login(INVESTOR)).token)
    expect(s.holders.map((h) => h.id)).toEqual(['u6'])
    for (const m of s.months) expect(m.split.map((x) => x.id)).toEqual(['u6'])
    expect((await call('/investors/summary', { token: (await login(CASHIER)).token })).status).toBe(403)
  })
})

describe('share split', () => {
  it('must total exactly 100%, once per person, active users only', async () => {
    const cases: [{ userId: string; sharePct: number }[], string][] = [
      [[{ userId: 'u1', sharePct: 50 }, { userId: 'u6', sharePct: 49.99 }], 'Shares must add up to exactly 100%'],
      [[{ userId: 'u1', sharePct: 50 }, { userId: 'u1', sharePct: 50 }], 'Each person can appear once'],
      [[{ userId: 'u1', sharePct: 100 }, { userId: 'u6', sharePct: 0 }], 'sharePct'],
      [[{ userId: 'u1', sharePct: 66.666 }, { userId: 'u6', sharePct: 33.334 }], 'sharePct'],
    ]
    for (const [shares, message] of cases) {
      const e = await errorOf(await setShares(shares))
      expect(e.code).toBe('invalid_input')
      expect(e.message).toContain(message)
    }
    expect((await errorOf(await setShares([{ userId: 'u1', sharePct: 60 }, { userId: 'nope', sharePct: 40 }]))).code).toBe('unknown_user')
  })

  it('is owner-only', async () => {
    const body = [{ userId: 'u1', sharePct: 100 }]
    expect((await setShares(body, (await login(MANAGER)).token)).status).toBe(403)
    expect((await setShares(body, (await login(INVESTOR)).token)).status).toBe(403)
  })

  it('replaces the whole split (accepting 33.33 + 33.33 + 33.34) and the summary follows', async () => {
    const res = await setShares([{ userId: 'u1', sharePct: 33.34 }, { userId: 'u6', sharePct: 33.33 }, { userId: 'u7', sharePct: 33.33 }])
    expect(res.status).toBe(200)
    expect((await json<{ sharePct: number }[]>(res)).map((h) => h.sharePct)).toEqual([33.34, 33.33, 33.33])

    expect((await setShares([{ userId: 'u1', sharePct: 70 }, { userId: 'u2', sharePct: 30 }])).status).toBe(200) // u6, u7 drop out
    const s = await summary()
    expect(s.holders.map((h) => [h.id, h.sharePct])).toEqual([['u1', 70], ['u2', 30]])
    expect(s.months.at(-1)!.split.map((x) => x.id)).toEqual(['u1', 'u2'])
    expect((await summary((await login(INVESTOR)).token)).holders).toEqual([]) // u6 no longer holds a share
  })

  it('cannot be bent by creating a user with a share', async () => {
    const res = await call('/users', { body: { name: 'New Partner', phone: '9847099999', pin: '4321', role: 'Investor', modules: ['investors'], sharePct: 25 }, token: owner })
    expect(res.status).toBe(201)
    expect((await json<{ sharePct: number | null }>(res)).sharePct).toBeNull()
    const total = (await summary()).holders.reduce((t, h) => t + h.sharePct, 0)
    expect(total).toBe(100)
  })
})
