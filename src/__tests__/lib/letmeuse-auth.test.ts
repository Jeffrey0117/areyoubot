import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createHmac } from 'node:crypto'
import { verifyLetmeuseToken } from '@/lib/letmeuse-auth'

const SECRET = 'app-secret-under-test'
const OLD_ENV = { ...process.env }

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')

// Build a properly HS256-signed letmeuse token: signature over header.payload,
// matching letmeuse jose SignJWT output —
// base64url(HMAC-SHA256(secret, `${b64(header)}.${b64(payload)}`)).
function signToken(
  payload: Record<string, unknown>,
  secret = SECRET,
  header: Record<string, unknown> = { alg: 'HS256', typ: 'JWT' }
): string {
  const signingInput = `${b64(header)}.${b64(payload)}`
  const sig = createHmac('sha256', secret).update(signingInput).digest('base64url')
  return `${signingInput}.${sig}`
}

const future = Math.floor(Date.now() / 1000) + 3600
const past = Math.floor(Date.now() / 1000) - 3600

beforeEach(() => {
  process.env.LETMEUSE_APP_SECRET = SECRET
})

afterEach(() => {
  process.env = { ...OLD_ENV }
})

describe('verifyLetmeuseToken (HS256 signature verified)', () => {
  it('returns the payload for a correctly-signed, unexpired token', () => {
    const token = signToken({ sub: 'usr_1', email: 'admin@x.com', name: 'Admin', role: 'user', exp: future })
    expect(verifyLetmeuseToken(token)).toEqual({
      sub: 'usr_1',
      email: 'admin@x.com',
      name: 'Admin',
      role: 'user',
    })
  })

  it('returns null when the payload is tampered (signature no longer matches)', () => {
    const token = signToken({ sub: 'usr_1', email: 'victim@x.com', exp: future })
    // forge an admin email into the payload but keep the original signature
    const [h, , s] = token.split('.')
    const forged = `${h}.${b64({ sub: 'usr_1', email: 'admin@x.com', exp: future })}.${s}`
    expect(verifyLetmeuseToken(forged)).toBeNull()
  })

  it('returns null when signed with the wrong secret', () => {
    const token = signToken({ sub: 'usr_1', email: 'admin@x.com', exp: future }, 'some-other-secret')
    expect(verifyLetmeuseToken(token)).toBeNull()
  })

  it('returns null when the signature segment is absent/garbage', () => {
    const signingInput = `${b64({ alg: 'HS256' })}.${b64({ sub: 'u', email: 'a@x.com', exp: future })}`
    expect(verifyLetmeuseToken(`${signingInput}.`)).toBeNull()
    expect(verifyLetmeuseToken(`${signingInput}.notavalidsig`)).toBeNull()
  })

  it('returns null for a correctly-signed but expired token', () => {
    const token = signToken({ sub: 'usr_1', email: 'admin@x.com', exp: past })
    expect(verifyLetmeuseToken(token)).toBeNull()
  })

  it('rejects alg=none / non-HS256 header even if structurally valid', () => {
    const header = { alg: 'none', typ: 'JWT' }
    const payload = { sub: 'u', email: 'admin@x.com', exp: future }
    const unsigned = `${b64(header)}.${b64(payload)}.`
    expect(verifyLetmeuseToken(unsigned)).toBeNull()
  })

  it('returns null for malformed tokens (not three parts)', () => {
    expect(verifyLetmeuseToken('garbage')).toBeNull()
    expect(verifyLetmeuseToken('a.b')).toBeNull()
    expect(verifyLetmeuseToken('')).toBeNull()
  })

  it('returns null when the payload is not valid base64url json (even if sig matches)', () => {
    // sign over a bogus payload segment so the signature passes but JSON.parse fails
    const header = b64({ alg: 'HS256' })
    const badPayload = '!!!notjson!!!'
    const sig = createHmac('sha256', SECRET).update(`${header}.${badPayload}`).digest('base64url')
    expect(verifyLetmeuseToken(`${header}.${badPayload}.${sig}`)).toBeNull()
  })

  it('returns null when exp is missing even if signature is valid', () => {
    const token = signToken({ sub: 'usr_1', email: 'admin@x.com' })
    expect(verifyLetmeuseToken(token)).toBeNull()
  })

  it('returns null when email is missing even if signature is valid', () => {
    const token = signToken({ sub: 'usr_1', exp: future })
    expect(verifyLetmeuseToken(token)).toBeNull()
  })

  it('tolerates a missing name (optional) on a valid token', () => {
    const token = signToken({ sub: 'usr_1', email: 'a@x.com', role: 'user', exp: future })
    const out = verifyLetmeuseToken(token)
    expect(out?.email).toBe('a@x.com')
    expect(out?.name).toBeUndefined()
  })

  it('fails closed when LETMEUSE_APP_SECRET is unset (no verify -> no trust, any env)', () => {
    delete process.env.LETMEUSE_APP_SECRET
    const token = signToken({ sub: 'u', email: 'admin@x.com', exp: future })
    expect(verifyLetmeuseToken(token)).toBeNull()
  })
})
