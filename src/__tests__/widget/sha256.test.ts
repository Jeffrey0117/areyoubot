import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { sha256Bytes } from '@/widget/sha256'

function nodeDigest(s: string): Buffer {
  return createHash('sha256').update(s, 'utf8').digest()
}

const cases: ReadonlyArray<readonly [string, string]> = [
  ['empty string', ''],
  ['abc', 'abc'],
  ['single char', 'a'],
  ['55 bytes (block boundary - 9)', 'a'.repeat(55)],
  ['56 bytes (block boundary)', 'a'.repeat(56)],
  ['64 bytes (exact block)', 'a'.repeat(64)],
  ['65 bytes (over a block)', 'a'.repeat(65)],
  ['long string', 'The quick brown fox jumps over the lazy dog'.repeat(40)],
  ['utf-8 multibyte', '你好世界 😏 áé'],
  ['challengeToken shape', 'eyJzaXRla2V5IjoiYXliX2RlbW8ifQ.aGVsbG8td29ybGQtaG1hYw:0'],
  ['challengeToken + colon + solution', 'eyJzaXRla2V5IjoiYXliX2RlbW8ifQ.aGVsbG8td29ybGQ:1234567'],
]

describe('sha256Bytes', () => {
  it('returns 32 bytes', () => {
    expect(sha256Bytes('abc').length).toBe(32)
  })

  for (const [label, input] of cases) {
    it(`matches Node crypto byte-for-byte: ${label}`, () => {
      const ours = Buffer.from(sha256Bytes(input))
      const theirs = nodeDigest(input)
      expect(ours.equals(theirs)).toBe(true)
    })
  }

  it('matches Node crypto for many random-ish inputs', () => {
    for (let i = 0; i < 200; i++) {
      const s = `nonce:${i}:${'x'.repeat(i % 130)}`
      expect(Buffer.from(sha256Bytes(s)).equals(nodeDigest(s))).toBe(true)
    }
  })
})
