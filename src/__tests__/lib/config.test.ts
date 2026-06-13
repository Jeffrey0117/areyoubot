import { describe, it, expect } from 'vitest'
import { getHmacSecret, DEFAULT_DIFFICULTY, CHALLENGE_TTL_MS, MAX_DIFFICULTY } from '@/lib/config'

describe('config', () => {
  it('reads HMAC secret from env', () => {
    process.env.AREYOUBOT_HMAC_SECRET = 'abc'
    expect(getHmacSecret()).toBe('abc')
  })
  it('throws when HMAC secret missing', () => {
    delete process.env.AREYOUBOT_HMAC_SECRET
    expect(() => getHmacSecret()).toThrow()
  })
  it('exposes sane defaults', () => {
    expect(DEFAULT_DIFFICULTY).toBe(18)
    expect(MAX_DIFFICULTY).toBe(24)
    expect(CHALLENGE_TTL_MS).toBe(120_000)
  })
})
