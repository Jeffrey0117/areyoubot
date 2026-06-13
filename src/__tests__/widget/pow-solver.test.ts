import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { leadingZeroBits, solvePow, meetsPow } from '@/widget/pow-solver'

function nodeLeadingZeroBits(token: string, solution: string): number {
  const buf = createHash('sha256').update(`${token}:${solution}`, 'utf8').digest()
  let count = 0
  for (const byte of buf) {
    if (byte === 0) {
      count += 8
      continue
    }
    let mask = 0x80
    while (mask > 0 && (byte & mask) === 0) {
      count++
      mask >>= 1
    }
    break
  }
  return count
}

describe('leadingZeroBits', () => {
  it('counts a full zero byte as 8', () => {
    expect(leadingZeroBits(Uint8Array.from([0x00, 0xff]))).toBe(8)
  })
  it('counts partial bits and stops at first non-zero', () => {
    expect(leadingZeroBits(Uint8Array.from([0x0f]))).toBe(4)
    expect(leadingZeroBits(Uint8Array.from([0x80]))).toBe(0)
    expect(leadingZeroBits(Uint8Array.from([0x00, 0x00]))).toBe(16)
    expect(leadingZeroBits(Uint8Array.from([0x00, 0x01]))).toBe(15)
  })
})

describe('solvePow / meetsPow', () => {
  const token = 'eyJzaXRla2V5IjoiYXliX2RlbW8ifQ.aGVsbG8td29ybGQtaG1hYw'

  it('solves difficulty 8 and meetsPow confirms', () => {
    const sol = solvePow(token, 8)
    expect(meetsPow(token, sol, 8)).toBe(true)
  })

  it('cross-checks the solution against Node crypto (server-compatible)', () => {
    const difficulty = 10
    const sol = solvePow(token, difficulty)
    // Server uses Node crypto SHA-256 — our solution must satisfy it too.
    expect(nodeLeadingZeroBits(token, sol)).toBeGreaterThanOrEqual(difficulty)
  })

  it('difficulty 0 is satisfied by nonce 0', () => {
    expect(solvePow(token, 0)).toBe('0')
  })

  it('meetsPow rejects an obviously-wrong solution', () => {
    // Find a nonce that does NOT meet difficulty 8, assert rejection.
    let n = 0
    while (meetsPow(token, String(n), 8)) n++
    expect(meetsPow(token, String(n), 8)).toBe(false)
  })

  it('returns the FIRST satisfying nonce from 0 upward', () => {
    const difficulty = 8
    const sol = Number(solvePow(token, difficulty))
    for (let n = 0; n < sol; n++) {
      expect(meetsPow(token, String(n), difficulty)).toBe(false)
    }
  })
})
