import { describe, it, expect } from 'vitest'
import { leadingZeroBits, sha256, meetsPow } from '@/lib/pow'

describe('leadingZeroBits', () => {
  it('counts a full zero byte as 8', () => {
    expect(leadingZeroBits(Uint8Array.from([0x00, 0xff]))).toBe(8)
  })
  it('counts partial bits in a byte', () => {
    expect(leadingZeroBits(Uint8Array.from([0x0f]))).toBe(4)
    expect(leadingZeroBits(Uint8Array.from([0x80]))).toBe(0)
    expect(leadingZeroBits(Uint8Array.from([0x00, 0x00]))).toBe(16)
  })
})

describe('meetsPow', () => {
  it('difficulty 0 always passes', () => {
    expect(meetsPow('abc', 'whatever', 0)).toBe(true)
  })
  it('accepts a brute-forced solution at difficulty 8', () => {
    let n = 0
    while (leadingZeroBits(sha256(`token:${n}`)) < 8) n++
    expect(meetsPow('token', String(n), 8)).toBe(true)
  })
  it('rejects a wrong solution at difficulty 8', () => {
    let n = 0
    while (leadingZeroBits(sha256(`token:${n}`)) >= 8) n++
    expect(meetsPow('token', String(n), 8)).toBe(false)
  })
})
