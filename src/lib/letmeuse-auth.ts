// letmeuse JWT verification — ES256 only, public key from JWKS.
//
// This endpoint family (/api/admin/*) is reachable on the public internet, so
// we MUST verify the token's signature: decoding the base64url payload alone
// would let anyone forge an admin email and pass the gate.
//
// 🔒 2026-11-07: switched from HS256 to ES256.
// HS256 signs with the app *secret*, which means the verifier has to hold the
// signing key — and once that secret leaks, anyone can mint a token with any
// `sub`/`email`/`role` they like and walk straight into the admin API. That is
// exactly how pokkit was compromised on 2026-10-25. letmeuse has signed access
// tokens with ES256 since 2026-10-30 and removed its own HS256 path, so
// HS256 here was pure attack surface — and, because real tokens are ES256, it
// also meant every genuine login was rejected (the admin API was unreachable).
//
// With ES256 we verify against the JWKS *public* key: areyoubot never holds a
// signing key, so even a leaked app secret cannot forge a token.
//
// Machine-to-machine callers (the CloudPipe gateway / MCP tools) do NOT use a
// JWT — see admin-auth.ts, they present AREYOUBOT_SERVICE_TOKEN instead.
// Minting a long-lived fake user JWT for a machine is the same mistake in
// another costume.
//
// Zero external deps — node's built-in crypto only.

import crypto from 'node:crypto'
import { getJwksPublicKey } from './jwks-cache'

export interface LetmeuseClaims {
  readonly sub: string
  readonly email: string
  readonly name?: string
  readonly role?: string
}

export interface VerifyDeps {
  /** Public-key lookup by `kid`. Injected in tests; defaults to the JWKS cache. */
  readonly getKey?: (kid: string) => crypto.KeyObject | null
  /** Expected `app` claim. Defaults to LETMEUSE_APP_ID. */
  readonly appId?: string
}

// Strict base64url. `Buffer.from(x, 'base64url')` silently ignores characters
// outside the alphabet, so without this one token has many equivalent
// spellings — which would defeat anything that ever keys on the token string
// (replay cache, revocation list, rate-limit bucket, log correlation).
// An ES256 signature is 64 bytes (r||s) => exactly 86 unpadded base64url
// characters; that length check also rejects DER-encoded signatures.
const B64URL = /^[A-Za-z0-9_-]+$/
const B64URL_ES256_SIG = /^[A-Za-z0-9_-]{86}$/

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

export function verifyLetmeuseToken(token: string, deps: VerifyDeps = {}): LetmeuseClaims | null {
  if (typeof token !== 'string' || !token) return null

  const getKey = deps.getKey ?? getJwksPublicKey
  const appId = deps.appId ?? process.env.LETMEUSE_APP_ID ?? ''
  // Fail closed: letmeuse signs EVERY app's tokens with the SAME ES256 key, so
  // the `app` claim is the only tenancy boundary there is. Without our own app
  // id we cannot check it — and would be accepting any letmeuse user from any
  // app in the ecosystem.
  if (!appId) return null

  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [headerSeg, payloadSeg, providedSig] = parts
  if (!B64URL.test(headerSeg) || !B64URL.test(payloadSeg)) return null
  if (!B64URL_ES256_SIG.test(providedSig)) return null

  // Lock the algorithm to ES256 — rejects alg:none, HS256 (a leaked app secret
  // must not be forgeable into a token) and any algorithm confusion.
  const header = decodeSegment(headerSeg)
  if (!header || header.alg !== 'ES256') return null
  if (typeof header.kid !== 'string' || !header.kid) return null

  const publicKey = getKey(header.kid)
  if (!publicKey) return null // unknown kid → no trust

  let verified = false
  try {
    verified = crypto.verify(
      'sha256',
      Buffer.from(`${headerSeg}.${payloadSeg}`),
      { key: publicKey, dsaEncoding: 'ieee-p1363' },
      Buffer.from(providedSig, 'base64url'),
    )
  } catch {
    return null
  }
  if (!verified) return null

  // Signature verified — now decode and validate claims.
  const payload = decodeSegment(payloadSeg)
  if (!payload) return null

  const now = Math.floor(Date.now() / 1000)
  // exp must be a number: a token with no exp (or a string exp) would never
  // expire, and the 4h lifetime is the only revocation this design has.
  const exp = payload.exp
  if (typeof exp !== 'number') return null
  if (exp <= now) return null
  if (typeof payload.nbf === 'number' && payload.nbf > now) return null
  // A token minted for another app must not open this one.
  if (payload.app !== appId) return null

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
