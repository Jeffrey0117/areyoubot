import { createHash } from 'node:crypto'

export function sha256(input: string): Buffer {
  return createHash('sha256').update(input).digest()
}

export function leadingZeroBits(buf: Uint8Array): number {
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

export function meetsPow(challengeToken: string, solution: string, difficulty: number): boolean {
  return leadingZeroBits(sha256(`${challengeToken}:${solution}`)) >= difficulty
}
