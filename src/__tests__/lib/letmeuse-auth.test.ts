import { describe, it, expect } from 'vitest'
import { verifyLetmeuseToken } from '@/lib/letmeuse-auth'

// Build a fake JWT-shaped string `header.payloadB64url.sig`. We never verify the
// signature (letmeuse internal-trust pattern) — only base64url-decode the payload
// and check exp. So `sig` can be anything.
function makeToken(payload: Record<string, unknown>, sig = 'sig'): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.${sig}`
}

const future = Math.floor(Date.now() / 1000) + 3600
const past = Math.floor(Date.now() / 1000) - 3600

describe('verifyLetmeuseToken', () => {
  it('returns the payload fields for a valid, unexpired token', () => {
    const token = makeToken({
      sub: 'usr_1',
      email: 'admin@x.com',
      name: 'Admin',
      role: 'user',
      exp: future,
    })
    const out = verifyLetmeuseToken(token)
    expect(out).toEqual({ sub: 'usr_1', email: 'admin@x.com', name: 'Admin', role: 'user' })
  })

  it('returns null for an expired token', () => {
    const token = makeToken({ sub: 'usr_1', email: 'admin@x.com', exp: past })
    expect(verifyLetmeuseToken(token)).toBeNull()
  })

  it('returns null for a malformed token (not three parts)', () => {
    expect(verifyLetmeuseToken('garbage')).toBeNull()
    expect(verifyLetmeuseToken('a.b')).toBeNull()
    expect(verifyLetmeuseToken('')).toBeNull()
  })

  it('returns null when the payload is not valid base64url json', () => {
    expect(verifyLetmeuseToken('h.!!!notbase64!!!.s')).toBeNull()
  })

  it('returns null when exp is missing (refuse tokens without expiry)', () => {
    const token = makeToken({ sub: 'usr_1', email: 'admin@x.com' })
    expect(verifyLetmeuseToken(token)).toBeNull()
  })

  it('returns null when email is missing', () => {
    const token = makeToken({ sub: 'usr_1', exp: future })
    expect(verifyLetmeuseToken(token)).toBeNull()
  })

  it('tolerates a missing name (optional)', () => {
    const token = makeToken({ sub: 'usr_1', email: 'a@x.com', role: 'user', exp: future })
    const out = verifyLetmeuseToken(token)
    expect(out?.email).toBe('a@x.com')
    expect(out?.name).toBeUndefined()
  })
})
