import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import crypto from 'node:crypto'
import { verifyLetmeuseToken } from '@/lib/letmeuse-auth'

const APP = 'app_test_areyoubot'
const KID = 'test-kid'
const OLD_ENV = { ...process.env }

// letmeuse's ES256 signing key (simulated). We only ever hand the verifier the
// PUBLIC half — that is the whole point of the ES256 switch.
const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })

const getKey = (kid: string) => (kid === KID ? publicKey : null)
const deps = { getKey, appId: APP }

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')

/**
 * Build a properly ES256-signed letmeuse token. The signature is raw r||s
 * ("ieee-p1363"), which is what JWS mandates and what letmeuse's jose
 * SignJWT emits — DER would not verify.
 */
function signToken(
  payload: Record<string, unknown>,
  opts: { key?: crypto.KeyObject; header?: Record<string, unknown>; der?: boolean } = {}
): string {
  const header = { alg: 'ES256', typ: 'JWT', kid: KID, ...(opts.header ?? {}) }
  const signingInput = `${b64(header)}.${b64(payload)}`
  const sig = crypto.sign('sha256', Buffer.from(signingInput), {
    key: opts.key ?? privateKey,
    ...(opts.der ? {} : { dsaEncoding: 'ieee-p1363' as const }),
  })
  return `${signingInput}.${sig.toString('base64url')}`
}

/** A legacy HS256 token, signed with the (possibly leaked) app secret. */
function signHs256(payload: Record<string, unknown>, secret: string): string {
  const signingInput = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}`
  return `${signingInput}.${crypto.createHmac('sha256', secret).update(signingInput).digest('base64url')}`
}

const future = Math.floor(Date.now() / 1000) + 3600
const past = Math.floor(Date.now() / 1000) - 3600

const valid = (extra: Record<string, unknown> = {}) =>
  signToken({ sub: 'u1', email: 'admin@x.com', app: APP, exp: future, ...extra })

beforeEach(() => {
  process.env.LETMEUSE_APP_ID = APP
})

afterEach(() => {
  process.env = { ...OLD_ENV }
})

describe('verifyLetmeuseToken (ES256, JWKS public key)', () => {
  it('returns the claims for a correctly-signed, unexpired token', async () => {
    const out = await verifyLetmeuseToken(valid({ name: 'Jeff', role: 'admin' }), deps)
    expect(out).not.toBeNull()
    expect(out?.sub).toBe('u1')
    expect(out?.email).toBe('admin@x.com')
    expect(out?.name).toBe('Jeff')
    expect(out?.role).toBe('admin')
  })

  it('reads the expected app id from LETMEUSE_APP_ID when not injected', async () => {
    expect(await verifyLetmeuseToken(valid(), { getKey })).not.toBeNull()
  })

  it('🔒 rejects HS256 even when signed with the real app secret (pokkit 2026-10-25 regression)', async () => {
    // Attack: the app secret leaks, the attacker self-signs an admin token.
    // ES256-only verification makes a leaked secret useless for forgery.
    const forged = signHs256({ sub: 'attacker', email: 'admin@x.com', app: APP, exp: future }, 'leaked-secret')
    expect(await verifyLetmeuseToken(forged, deps)).toBeNull()
  })

  it('returns null when the payload is tampered (signature no longer matches)', async () => {
    const token = valid()
    const [h, , s] = token.split('.')
    const tampered = `${h}.${b64({ sub: 'u1', email: 'evil@x.com', app: APP, exp: future })}.${s}`
    expect(await verifyLetmeuseToken(tampered, deps)).toBeNull()
  })

  it('returns null when signed with the wrong key (same kid)', async () => {
    const attacker = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
    expect(await verifyLetmeuseToken(valid(), { ...deps, getKey: () => publicKey })).not.toBeNull()
    expect(
      await verifyLetmeuseToken(signToken({ sub: 'u1', email: 'a@x.com', app: APP, exp: future }, { key: attacker.privateKey }), deps)
    ).toBeNull()
  })

  it('🔒 returns null for an unknown kid, and when the header has no kid', async () => {
    expect(await verifyLetmeuseToken(valid(), { ...deps, getKey: () => null })).toBeNull()
    expect(await verifyLetmeuseToken(signToken({ sub: 'u1', email: 'a@x.com', app: APP, exp: future }, { header: { kid: undefined } }), deps)).toBeNull()
  })

  it('🔒 returns null for a DER-encoded signature (JWS requires raw r||s)', async () => {
    expect(await verifyLetmeuseToken(signToken({ sub: 'u1', email: 'a@x.com', app: APP, exp: future }, { der: true }), deps)).toBeNull()
  })

  it('returns null when the signature segment is absent/garbage', async () => {
    const [h, p] = valid().split('.')
    expect(await verifyLetmeuseToken(`${h}.${p}.`, deps)).toBeNull()
    expect(await verifyLetmeuseToken(`${h}.${p}.AAAA`, deps)).toBeNull()
    expect(await verifyLetmeuseToken(`${h}.${p}.${'A'.repeat(86)}`, deps)).toBeNull()
  })

  it('🔒 rejects a signature segment with non-base64url characters', async () => {
    const [h, p, s] = valid().split('.')
    expect(await verifyLetmeuseToken(`${h}.${p}.${s.slice(0, 40)}!${s.slice(41)}`, deps)).toBeNull()
    expect(await verifyLetmeuseToken(`${h}.${p}.${s}=`, deps)).toBeNull()
  })

  it('rejects alg=none / non-ES256 header even if structurally valid', async () => {
    const h = b64({ alg: 'none', typ: 'JWT', kid: KID })
    const p = b64({ sub: 'u1', email: 'a@x.com', app: APP, exp: future })
    expect(await verifyLetmeuseToken(`${h}.${p}.${'A'.repeat(86)}`, deps)).toBeNull()
  })

  it('returns null for a correctly-signed but expired token', async () => {
    expect(await verifyLetmeuseToken(valid({ exp: past }), deps)).toBeNull()
  })

  it('🔒 returns null when exp is missing or not a number (no exp must not mean eternal)', async () => {
    expect(await verifyLetmeuseToken(signToken({ sub: 'u1', email: 'a@x.com', app: APP }), deps)).toBeNull()
    expect(await verifyLetmeuseToken(valid({ exp: String(future) }), deps)).toBeNull()
  })

  it('🔒 returns null when nbf is still in the future', async () => {
    expect(await verifyLetmeuseToken(valid({ nbf: future }), deps)).toBeNull()
  })

  it('🔒 returns null for another app, or no app claim at all', async () => {
    // letmeuse signs every app's tokens with the SAME key, so `app` is the
    // only tenancy boundary: without this check any letmeuse user of any app
    // could reach this admin API.
    expect(await verifyLetmeuseToken(valid({ app: 'app_other' }), deps)).toBeNull()
    expect(await verifyLetmeuseToken(signToken({ sub: 'u1', email: 'a@x.com', exp: future }), deps)).toBeNull()
  })

  it('🔒 fails closed when LETMEUSE_APP_ID is unset (config drift must not open the door)', async () => {
    delete process.env.LETMEUSE_APP_ID
    expect(await verifyLetmeuseToken(valid(), { getKey })).toBeNull()
  })

  it('returns null for malformed tokens (not three parts)', async () => {
    for (const bad of ['', 'abc', 'a.b', 'a.b.c.d']) {
      expect(await verifyLetmeuseToken(bad, deps)).toBeNull()
    }
  })

  it('returns null when the payload is not valid base64url json (even if sig matches)', async () => {
    const header = b64({ alg: 'ES256', typ: 'JWT', kid: KID })
    const payload = Buffer.from('not json').toString('base64url')
    const sig = crypto.sign('sha256', Buffer.from(`${header}.${payload}`), {
      key: privateKey, dsaEncoding: 'ieee-p1363',
    })
    expect(await verifyLetmeuseToken(`${header}.${payload}.${sig.toString('base64url')}`, deps)).toBeNull()
  })

  it('returns null when email is missing even if signature is valid', async () => {
    expect(await verifyLetmeuseToken(signToken({ sub: 'u1', app: APP, exp: future }), deps)).toBeNull()
  })

  it('returns null when sub is missing or not a string', async () => {
    expect(await verifyLetmeuseToken(signToken({ email: 'a@x.com', app: APP, exp: future }), deps)).toBeNull()
    expect(await verifyLetmeuseToken(valid({ sub: 12345 }), deps)).toBeNull()
  })

  it('tolerates a missing name (optional) on a valid token', async () => {
    const out = await verifyLetmeuseToken(valid(), deps)
    expect(out).not.toBeNull()
    expect(out?.name).toBeUndefined()
  })
})
