import { createHmac, timingSafeEqual } from 'node:crypto'

export interface ChallengePayload {
  sitekey: string
  nonceSeed: string
  difficulty: number
  iat: number
  exp: number
}

function b64url(buf: Buffer): string {
  return buf.toString('base64url')
}

function hmac(payload: string, secret: string): string {
  return b64url(createHmac('sha256', secret).update(payload).digest())
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

export function signChallenge(p: ChallengePayload, secret: string): string {
  const payload = b64url(Buffer.from(JSON.stringify(p)))
  return `${payload}.${hmac(payload, secret)}`
}

export function verifyChallengeToken(
  challengeToken: string,
  secret: string,
  now: number
): ChallengePayload | null {
  const parts = challengeToken.split('.')
  if (parts.length !== 2) return null
  const [payload, sig] = parts
  if (!safeEqual(sig, hmac(payload, secret))) return null
  let p: ChallengePayload
  try {
    p = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  if (typeof p?.exp !== 'number' || now > p.exp) return null
  return p
}
