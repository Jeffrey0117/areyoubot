import { describe, it, expect } from 'vitest'
import { signChallenge, verifyChallengeToken, type ChallengePayload } from '@/lib/challenge'

const SECRET = 'test-hmac-secret'
const base: ChallengePayload = { sitekey: 'ayb_x', nonceSeed: 'seed', difficulty: 18, iat: 1000, exp: 2000 }

describe('challenge token', () => {
  it('round-trips a valid token before expiry', () => {
    const token = signChallenge(base, SECRET)
    expect(verifyChallengeToken(token, SECRET, 1500)).toEqual(base)
  })
  it('rejects a tampered payload', () => {
    const token = signChallenge(base, SECRET)
    const [payload, hmac] = token.split('.')
    expect(verifyChallengeToken(`${payload}x.${hmac}`, SECRET, 1500)).toBeNull()
  })
  it('rejects wrong secret', () => {
    const token = signChallenge(base, SECRET)
    expect(verifyChallengeToken(token, 'other', 1500)).toBeNull()
  })
  it('rejects after expiry', () => {
    const token = signChallenge(base, SECRET)
    expect(verifyChallengeToken(token, SECRET, 2001)).toBeNull()
  })
  it('rejects malformed token', () => {
    expect(verifyChallengeToken('garbage', SECRET, 1500)).toBeNull()
  })
})
