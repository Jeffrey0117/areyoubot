// letmeuse JWT verification — HS256 signature verified.
//
// This endpoint family (/api/admin/*) is reachable on the public internet, so
// we MUST verify the token's signature: decoding the base64url payload alone
// would let anyone forge an admin email and pass the gate. letmeuse mints HS256
// tokens signed with the app secret over `${header}.${payload}` (standard JWS).
// We recompute that HMAC with our configured app secret and compare in constant
// time, lock the algorithm to HS256 (no alg-confusion / `none`), then enforce
// exp and required claims. Zero external deps — node's built-in crypto only.

import { createHmac, timingSafeEqual } from 'node:crypto'

export interface LetmeuseClaims {
  readonly sub: string
  readonly email: string
  readonly name?: string
  readonly role?: string
}

function decodeSegment(segment: string): Record<string, unknown> | null {
  try {
    const json = Buffer.from(segment, 'base64url').toString('utf8')
    const parsed = JSON.parse(json)
    if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>
    return null
  } catch {
    return null
  }
}

// Constant-time compare of two base64url signature strings. Length mismatch is
// itself a non-match; timingSafeEqual requires equal-length buffers.
function signaturesMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

export function verifyLetmeuseToken(token: string): LetmeuseClaims | null {
  if (typeof token !== 'string') return null

  const secret = process.env.LETMEUSE_APP_SECRET
  // Fail closed: with no secret we cannot verify the signature, so we must not
  // trust the token — in any environment. (Security first, even in dev.)
  if (!secret) return null

  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [headerSeg, payloadSeg, providedSig] = parts
  if (!providedSig) return null

  // Lock the algorithm to HS256 — reject alg:none and any algorithm confusion.
  const header = decodeSegment(headerSeg)
  if (!header || header.alg !== 'HS256') return null

  const expectedSig = createHmac('sha256', secret)
    .update(`${headerSeg}.${payloadSeg}`)
    .digest('base64url')
  if (!signaturesMatch(expectedSig, providedSig)) return null

  // Signature verified — now decode and validate claims.
  const payload = decodeSegment(payloadSeg)
  if (!payload) return null

  const exp = payload.exp
  if (typeof exp !== 'number') return null
  if (exp <= Math.floor(Date.now() / 1000)) return null

  const email = payload.email
  const sub = payload.sub
  if (typeof email !== 'string' || !email) return null
  if (typeof sub !== 'string' || !sub) return null

  return {
    sub,
    email,
    ...(typeof payload.name === 'string' ? { name: payload.name } : {}),
    ...(typeof payload.role === 'string' ? { role: payload.role } : {}),
  }
}
