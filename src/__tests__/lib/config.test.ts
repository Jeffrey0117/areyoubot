import { describe, it, expect } from 'vitest'
import { getHmacSecret, clampDifficulty, DEFAULT_DIFFICULTY, CHALLENGE_TTL_MS, MAX_DIFFICULTY } from '@/lib/config'

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

  describe('clampDifficulty', () => {
    it('passes through valid difficulties', () => {
      expect(clampDifficulty(10)).toBe(10)
      expect(clampDifficulty(1)).toBe(1)
    })
    it('caps above MAX_DIFFICULTY', () => {
      expect(clampDifficulty(999)).toBe(MAX_DIFFICULTY)
    })
    it('falls back to DEFAULT for 0/negative/NaN (never silently near-off)', () => {
      expect(clampDifficulty(0)).toBe(DEFAULT_DIFFICULTY)
      expect(clampDifficulty(-5)).toBe(DEFAULT_DIFFICULTY)
      expect(clampDifficulty(NaN)).toBe(DEFAULT_DIFFICULTY)
    })
  })
})
