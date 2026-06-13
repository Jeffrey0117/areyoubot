import { describe, it, expect, beforeEach } from 'vitest'
import { recordChallenge, recordVerify, drainDeltas, snapshot } from '@/lib/stats'

// Reset module state between tests by draining (clears all deltas to zero).
beforeEach(() => {
  drainDeltas()
})

describe('stats accumulator', () => {
  it('recordChallenge increments the challenge counter for a sitekey', () => {
    recordChallenge('ayb_a')
    recordChallenge('ayb_a')
    expect(snapshot()['ayb_a']).toEqual({ challenges: 2, verifySuccess: 0, verifyFail: 0 })
  })

  it('recordVerify(ok=true) increments verifySuccess, ok=false increments verifyFail', () => {
    recordVerify('ayb_a', true)
    recordVerify('ayb_a', true)
    recordVerify('ayb_a', false)
    expect(snapshot()['ayb_a']).toEqual({ challenges: 0, verifySuccess: 2, verifyFail: 1 })
  })

  it('tracks multiple sitekeys independently', () => {
    recordChallenge('ayb_a')
    recordVerify('ayb_b', true)
    const snap = snapshot()
    expect(snap['ayb_a'].challenges).toBe(1)
    expect(snap['ayb_b'].verifySuccess).toBe(1)
  })

  it('snapshot does NOT clear the deltas', () => {
    recordChallenge('ayb_a')
    snapshot()
    snapshot()
    expect(snapshot()['ayb_a'].challenges).toBe(1)
  })

  it('drainDeltas returns the current deltas and resets them to zero', () => {
    recordChallenge('ayb_a')
    recordVerify('ayb_a', true)
    recordVerify('ayb_b', false)

    const drained = drainDeltas()
    expect(drained.get('ayb_a')).toEqual({ challenges: 1, verifySuccess: 1, verifyFail: 0 })
    expect(drained.get('ayb_b')).toEqual({ challenges: 0, verifySuccess: 0, verifyFail: 1 })

    // after drain everything is zeroed
    expect(snapshot()).toEqual({})
    expect(drainDeltas().size).toBe(0)
  })

  it('drain returns a detached snapshot — later records do not mutate it', () => {
    recordChallenge('ayb_a')
    const drained = drainDeltas()
    recordChallenge('ayb_a')
    expect(drained.get('ayb_a')).toEqual({ challenges: 1, verifySuccess: 0, verifyFail: 0 })
  })

  it('is safe with empty/invalid sitekeys (never throws)', () => {
    expect(() => recordChallenge('')).not.toThrow()
    expect(() => recordVerify('', true)).not.toThrow()
    expect(() => recordChallenge(undefined as unknown as string)).not.toThrow()
    expect(() => recordVerify(null as unknown as string, false)).not.toThrow()
    // empty/invalid keys are ignored, not recorded
    expect(snapshot()['']).toBeUndefined()
  })

  it('snapshot of an unknown sitekey is simply absent', () => {
    expect(snapshot()['never-seen']).toBeUndefined()
  })
})
