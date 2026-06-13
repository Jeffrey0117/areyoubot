import { sha256Bytes } from './sha256'

// Count leading zero bits of a digest. Mirrors the server (src/lib/pow.ts):
// a full zero byte is +8, otherwise count the high zero bits of the first
// non-zero byte and stop.
export function leadingZeroBits(bytes: Uint8Array): number {
  let count = 0
  for (const byte of bytes) {
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

// True when SHA-256(challengeToken + ":" + solution) has >= difficulty leading
// zero bits — identical predicate to the server's meetsPow.
export function meetsPow(challengeToken: string, solution: string, difficulty: number): boolean {
  return leadingZeroBits(sha256Bytes(`${challengeToken}:${solution}`)) >= difficulty
}

// Brute-force from nonce 0 upward, returning the first solution string that
// satisfies the difficulty. Pure and deterministic.
export function solvePow(challengeToken: string, difficulty: number): string {
  for (let n = 0; ; n++) {
    const solution = String(n)
    if (leadingZeroBits(sha256Bytes(`${challengeToken}:${solution}`)) >= difficulty) {
      return solution
    }
  }
}
