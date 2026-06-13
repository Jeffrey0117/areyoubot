import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { WORKER_SOURCE } from '@/widget/worker-source'

// The worker runs an inlined copy of the SHA-256 + PoW logic (it cannot import
// modules across the Blob boundary as a single-file bundle). This test extracts
// that copy and proves it ALSO hashes byte-for-byte like Node crypto, so the
// duplicated code can never silently drift from the tested module.
function loadWorkerSolve(): {
  solvePow: (t: string, d: number) => string
  sha256Bytes: (s: string) => Uint8Array
} {
  // Strip the worker-only self.onmessage handler, then expose the functions.
  const body = WORKER_SOURCE.replace(/self\.onmessage[\s\S]*$/, '')
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const factory = new Function(`${body}\nreturn { solvePow: solvePow, sha256Bytes: sha256Bytes };`)
  return factory()
}

describe('worker-source inlined hashing', () => {
  const { solvePow, sha256Bytes } = loadWorkerSolve()

  const inputs = ['', 'abc', 'a'.repeat(64), '你好 😏', 'tok.en:12345']

  for (const s of inputs) {
    it(`sha256 matches Node crypto: "${s.slice(0, 12)}"`, () => {
      const ours = Buffer.from(sha256Bytes(s))
      const theirs = createHash('sha256').update(s, 'utf8').digest()
      expect(ours.equals(theirs)).toBe(true)
    })
  }

  it('solvePow output verifies under Node crypto', () => {
    const token = 'eyJzaXRla2V5IjoiYXliX2RlbW8ifQ.aGVsbG8'
    const difficulty = 10
    const sol = solvePow(token, difficulty)
    const buf = createHash('sha256').update(`${token}:${sol}`, 'utf8').digest()
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
    expect(count).toBeGreaterThanOrEqual(difficulty)
  })
})
