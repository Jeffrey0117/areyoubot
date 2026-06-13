import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createHmac } from 'node:crypto'

vi.mock('@/lib/selfize', () => ({
  sfCreateCollection: vi.fn().mockResolvedValue(undefined),
  sfCollectionExists: vi.fn().mockResolvedValue(true),
  sfFindOne: vi.fn(),
  sfCreate: vi.fn(),
  sfUpdate: vi.fn(),
  sfList: vi.fn().mockResolvedValue([]),
  sfDelete: vi.fn(),
}))

vi.mock('@/lib/stats', () => ({
  snapshot: vi.fn().mockReturnValue({}),
}))

import { sfList } from '@/lib/selfize'
import { snapshot } from '@/lib/stats'
import { GET } from '@/app/api/admin/stats/route'

const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>
const OLD_ENV = { ...process.env }
const APP_SECRET = 'areyoubot-app-secret-under-test'

function makeToken(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const signingInput = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}`
  const sig = createHmac('sha256', APP_SECRET).update(signingInput).digest('base64url')
  return `${signingInput}.${sig}`
}
const future = Math.floor(Date.now() / 1000) + 3600
const adminToken = makeToken({ sub: 'u', email: 'admin@x.com', role: 'user', exp: future })
const otherToken = makeToken({ sub: 'u2', email: 'bob@x.com', exp: future })

function getReq(auth?: string): Request {
  const headers: Record<string, string> = {}
  if (auth) headers['Authorization'] = `Bearer ${auth}`
  return new Request('http://x/api/admin/stats', { method: 'GET', headers })
}

const today = new Date().toISOString().slice(0, 10)

beforeEach(() => {
  vi.clearAllMocks()
  mock(sfList).mockResolvedValue([])
  mock(snapshot).mockReturnValue({})
  process.env.AREYOUBOT_ADMIN_EMAIL = 'admin@x.com'
  process.env.LETMEUSE_APP_SECRET = APP_SECRET
})
afterEach(() => {
  process.env = { ...OLD_ENV }
})

describe('GET /api/admin/stats (gated)', () => {
  it('401 without a token', async () => {
    const res = await GET(getReq())
    expect(res.status).toBe(401)
  })

  it('403 for a valid non-admin token', async () => {
    const res = await GET(getReq(otherToken))
    expect(res.status).toBe(403)
  })

  it('aggregates persisted buckets per site', async () => {
    mock(sfList).mockResolvedValue([
      { id: '1', date: today, sitekey: 'ayb_a', challenges: 10, verify_success: 7, verify_fail: 3 },
      { id: '2', date: today, sitekey: 'ayb_b', challenges: 4, verify_success: 4, verify_fail: 0 },
    ])
    const res = await GET(getReq(adminToken))
    expect(res.status).toBe(200)
    const body = await res.json()
    const a = body.sites.find((s: { sitekey: string }) => s.sitekey === 'ayb_a')
    expect(a).toEqual({ sitekey: 'ayb_a', challenges: 10, verifySuccess: 7, verifyFail: 3 })
  })

  it('folds the in-memory snapshot into today and per-site totals', async () => {
    mock(sfList).mockResolvedValue([
      { id: '1', date: today, sitekey: 'ayb_a', challenges: 10, verify_success: 7, verify_fail: 3 },
    ])
    mock(snapshot).mockReturnValue({
      ayb_a: { challenges: 2, verifySuccess: 1, verifyFail: 1 },
    })
    const body = await (await GET(getReq(adminToken))).json()
    const a = body.sites.find((s: { sitekey: string }) => s.sitekey === 'ayb_a')
    expect(a).toEqual({ sitekey: 'ayb_a', challenges: 12, verifySuccess: 8, verifyFail: 4 })
    const td = body.days.find((d: { date: string }) => d.date === today)
    expect(td).toEqual({ date: today, challenges: 12, verifySuccess: 8, verifyFail: 4 })
  })

  it('returns empty arrays when there is no data', async () => {
    const body = await (await GET(getReq(adminToken))).json()
    expect(body.sites).toEqual([])
    expect(body.days).toEqual([])
  })

  it('survives a selfize read failure (falls back to in-memory)', async () => {
    mock(sfList).mockRejectedValue(new Error('down'))
    mock(snapshot).mockReturnValue({ ayb_a: { challenges: 1, verifySuccess: 0, verifyFail: 0 } })
    const res = await GET(getReq(adminToken))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.sites).toEqual([{ sitekey: 'ayb_a', challenges: 1, verifySuccess: 0, verifyFail: 0 }])
  })

  it('never leaks a secret in the response', async () => {
    mock(sfList).mockResolvedValue([
      { id: '1', date: today, sitekey: 'ayb_a', secret: 'aybsk_should_not_appear', challenges: 1, verify_success: 0, verify_fail: 0 },
    ])
    const body = await (await GET(getReq(adminToken))).json()
    expect(JSON.stringify(body)).not.toContain('aybsk_')
  })
})
