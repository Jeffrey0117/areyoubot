import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('@/lib/jwks-cache', async () => {
  const h = await import('../helpers/test-jwks')
  return {
    getJwksPublicKey: (kid: string) => (kid === h.TEST_KID ? h.testPublicKey : null),
    getJwksPublicKeyAsync: async (kid: string) => (kid === h.TEST_KID ? h.testPublicKey : null),
    getJwksStats: () => ({ url: 'test', keys: 1, lastSuccessAt: null, lastError: null }),
  }
})

vi.mock('@/lib/selfize', () => ({
  sfCreateCollection: vi.fn().mockResolvedValue(undefined),
  sfCollectionExists: vi.fn().mockResolvedValue(true),
  sfFindOne: vi.fn(),
  sfCreate: vi.fn(),
  sfList: vi.fn(),
  sfDelete: vi.fn(),
}))

import { sfCreate, sfList } from '@/lib/selfize'
import { makeUserToken, TEST_APP_ID } from '../helpers/test-jwks'
import { POST, GET } from '@/app/api/admin/sites/route'

const OLD_ENV = { ...process.env }
// Tokens are ES256 now (letmeuse dropped HS256): sign with the shared test
// key and let the mocked jwks-cache above serve its public half.
function makeToken(payload: Record<string, unknown>): string {
  return makeUserToken(payload)
}
const future = Math.floor(Date.now() / 1000) + 3600
const adminToken = makeToken({ sub: 'u', email: 'admin@x.com', role: 'user', exp: future })
const otherToken = makeToken({ sub: 'u2', email: 'bob@x.com', exp: future })

function req(body: unknown, auth?: string): Request {
  const headers: Record<string, string> = {}
  if (auth) headers['Authorization'] = `Bearer ${auth}`
  return new Request('http://x/api/admin/sites', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}
function getReq(auth?: string): Request {
  const headers: Record<string, string> = {}
  if (auth) headers['Authorization'] = `Bearer ${auth}`
  return new Request('http://x/api/admin/sites', { method: 'GET', headers })
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.SELFIZE_URL = 'https://selfize.example.com'
  process.env.SELFIZE_TOKEN = 'tok'
  process.env.AREYOUBOT_ADMIN_EMAIL = 'admin@x.com'
  process.env.LETMEUSE_APP_ID = TEST_APP_ID
})
afterEach(() => {
  process.env = { ...OLD_ENV }
})

describe('POST /api/admin/sites (gated)', () => {
  it('401 without a token', async () => {
    const res = await POST(req({}))
    expect(res.status).toBe(401)
    expect(sfCreate).not.toHaveBeenCalled()
  })

  it('403 for a valid non-admin token', async () => {
    const res = await POST(req({}, otherToken))
    expect(res.status).toBe(403)
    expect(sfCreate).not.toHaveBeenCalled()
  })

  it('creates a site for the admin and returns sitekey + secret once', async () => {
    ;(sfCreate as ReturnType<typeof vi.fn>).mockImplementation(async (_c, rec) => ({ id: 'u', ...rec }))
    const res = await POST(req({ label: 'My Site', difficulty: 20 }, adminToken))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.sitekey).toMatch(/^ayb_/)
    expect(body.secret).toMatch(/^aybsk_/)
    expect(body.difficulty).toBe(20)
    expect(body.label).toBe('My Site')
    // it was persisted
    expect(sfCreate).toHaveBeenCalledTimes(1)
    const rec = (sfCreate as ReturnType<typeof vi.fn>).mock.calls[0][1]
    expect(rec.secret).toBe(body.secret)
  })

  it('defaults difficulty to 18 and clamps insane values', async () => {
    ;(sfCreate as ReturnType<typeof vi.fn>).mockImplementation(async (_c, rec) => ({ id: 'u', ...rec }))
    const a = await (await POST(req({}, adminToken))).json()
    expect(a.difficulty).toBe(18)
    const b = await (await POST(req({ difficulty: 9999 }, adminToken))).json()
    expect(b.difficulty).toBe(24)
  })

  it('generates unique sitekeys/secrets per call', async () => {
    ;(sfCreate as ReturnType<typeof vi.fn>).mockImplementation(async (_c, rec) => ({ id: 'u', ...rec }))
    const a = await (await POST(req({}, adminToken))).json()
    const b = await (await POST(req({}, adminToken))).json()
    expect(a.sitekey).not.toBe(b.sitekey)
    expect(a.secret).not.toBe(b.secret)
  })
})

describe('GET /api/admin/sites (gated)', () => {
  it('401 without a token', async () => {
    const res = await GET(getReq())
    expect(res.status).toBe(401)
  })

  it('403 for non-admin', async () => {
    const res = await GET(getReq(otherToken))
    expect(res.status).toBe(403)
  })

  it('lists sites WITHOUT secrets', async () => {
    ;(sfList as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: '1', sitekey: 'ayb_a', secret: 'aybsk_a', difficulty: 18, disabled: false, label: 'A', created_at: 't' },
      { id: '2', sitekey: 'ayb_b', secret: 'aybsk_b', difficulty: 20, disabled: true, label: 'B', created_at: 't2' },
    ])
    const res = await GET(getReq(adminToken))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.sites).toHaveLength(2)
    for (const s of body.sites) {
      expect(s.secret).toBeUndefined()
      expect(s).toHaveProperty('sitekey')
      expect(s).toHaveProperty('difficulty')
      expect(s).toHaveProperty('disabled')
    }
    // no secret leaks anywhere in the serialized response
    expect(JSON.stringify(body)).not.toContain('aybsk_')
  })
})
