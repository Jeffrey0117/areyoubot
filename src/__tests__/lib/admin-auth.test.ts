import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { gateAdmin } from '@/lib/admin-auth'

const OLD_ENV = { ...process.env }
const SERVICE_TOKEN = 'ayb_svc_test_0123456789abcdef'
const ADMIN_EMAIL = 'admin@example.com'

const req = (auth?: string) =>
  new Request('http://localhost/api/admin/sites', {
    headers: auth ? { authorization: auth } : {},
  })

beforeEach(() => {
  process.env.AREYOUBOT_SERVICE_TOKEN = SERVICE_TOKEN
  process.env.AREYOUBOT_ADMIN_EMAIL = ADMIN_EMAIL
  process.env.LETMEUSE_APP_ID = 'app_test_areyoubot'
  // No reachable JWKS in tests → the letmeuse path cannot verify anything,
  // which is exactly what we want when asserting the service-token path.
  process.env.LETMEUSE_JWKS_URL = 'http://127.0.0.1:1/api/jwks'
})

afterEach(() => {
  process.env = { ...OLD_ENV }
})

describe('gateAdmin', () => {
  it('401s with no Authorization header', async () => {
    expect(await gateAdmin(req())).toEqual({ ok: false, status: 401 })
  })

  it('401s when the header is not a Bearer token', async () => {
    expect(await gateAdmin(req('Basic abc'))).toEqual({ ok: false, status: 401 })
  })

  it('accepts the service token (machine path for the MCP tools)', async () => {
    const gate = await gateAdmin(req(`Bearer ${SERVICE_TOKEN}`))
    expect(gate.ok).toBe(true)
    if (gate.ok) {
      expect(gate.claims.sub).toBe('svc_areyoubot')
      expect(gate.claims.role).toBe('service')
    }
  })

  it('is case-insensitive about the Bearer scheme (RFC 6750)', async () => {
    expect((await gateAdmin(req(`bearer ${SERVICE_TOKEN}`))).ok).toBe(true)
  })

  it('🔒 rejects a near-miss service token', async () => {
    expect(await gateAdmin(req(`Bearer ${SERVICE_TOKEN}x`))).toEqual({ ok: false, status: 401 })
    expect(await gateAdmin(req(`Bearer ${SERVICE_TOKEN.slice(0, -1)}`))).toEqual({ ok: false, status: 401 })
    expect(await gateAdmin(req(`Bearer ${SERVICE_TOKEN.toUpperCase()}`))).toEqual({ ok: false, status: 401 })
  })

  it('🔒 does not accept an empty/unset service token as a password', async () => {
    delete process.env.AREYOUBOT_SERVICE_TOKEN
    expect(await gateAdmin(req('Bearer '))).toEqual({ ok: false, status: 401 })
    expect(await gateAdmin(req(`Bearer ${SERVICE_TOKEN}`))).toEqual({ ok: false, status: 401 })
  })

  it('🔒 rejects a self-signed HS256 "admin" JWT (the old service-token shape)', async () => {
    // The previous AREYOUBOT_SERVICE_TOKEN was a 1-year HS256 JWT with
    // sub=usr_mcp_admin. Accepting that shape is what forced HS256 support and
    // made a leaked app secret equal to full admin access.
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
    const input = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({
      sub: 'usr_mcp_admin', email: ADMIN_EMAIL, role: 'user',
      app: 'app_test_areyoubot', exp: Math.floor(Date.now() / 1000) + 3600,
    })}`
    // Signed with anything at all — ES256-only verification rejects it either way.
    expect(await gateAdmin(req(`Bearer ${input}.${'A'.repeat(43)}`))).toEqual({ ok: false, status: 401 })
  })

  it('🔒 an unverifiable letmeuse token is 401, never 403 (no identity => no "wrong person")', async () => {
    expect(await gateAdmin(req('Bearer not.a.token'))).toEqual({ ok: false, status: 401 })
  })
})
