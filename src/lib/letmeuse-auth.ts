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

import type crypto from 'node:crypto'
import { verifyJwtAsync, type Claims } from 'jwks-verify-kit'
import { getJwksPublicKeyAsync } from './jwks-cache'

export interface LetmeuseClaims {
  readonly sub: string
  readonly email: string
  readonly name?: string
  readonly role?: string
}

export interface VerifyDeps {
  /**
   * Public-key lookup by `kid`. Injected in tests; defaults to the JWKS
   * cache's async lookup (which waits for one fetch on a miss, so the first
   * request after a restart is not rejected with a cold cache).
   */
  readonly getKey?: (kid: string) => crypto.KeyObject | null | Promise<crypto.KeyObject | null>
  /** Expected `app` claim. Defaults to LETMEUSE_APP_ID. */
  readonly appId?: string
}

/**
 * Verify a letmeuse access token. Returns the claims, or null — never throws.
 *
 * 2026-11-08: the verification itself now lives in `jwks-verify-kit`. This copy
 * was already close to correct; what the kit adds is the stuff that is easy to
 * miss and expensive when missed:
 *   - **signature canonicalisation.** 86 base64url characters carry 516 bits
 *     while an ES256 signature is 512, so one signature has 16 equivalent
 *     spellings (the other 15 all verify). The length/charset check here did
 *     not catch that. Harmless today, but the moment anything keys on the token
 *     string — a revocation list, a replay/idempotency cache, a rate-limit
 *     bucket, log dedup — anyone holding one valid token can walk around it.
 *   - **claims no longer resolve through the prototype chain.** Any prototype
 *     pollution anywhere in the process, plus one validly-signed token with no
 *     `exp` and no `app`, would have meant: never expires, any tenant passes.
 *   - a payload carrying an own `__proto__` key is rejected outright (a host
 *     that ever does `Object.assign(session, claims)` is the victim).
 *   - a `crit` header is rejected (RFC 7515 §4.1.11: understand it or reject).
 *   - the key's curve must match the declared alg.
 *   - **requiredClaims is type-checked.** Passing a string (forgot the
 *     JSON.parse) would make the whole tenancy check vanish silently — and the
 *     test suite would stay green.
 *   - `onReject` gives a stable reason per rejected token, so a 401 is no longer
 *     a black box.
 *
 * 🔒 ES256 only (since 2026-11-07). HS256 signs with the app *secret*, which
 * means the verifier has to hold the signing key — and once that secret leaks,
 * anyone can mint a token with any `sub`/`email`/`role` they like and walk
 * straight into the admin API. That is exactly how pokkit was compromised on
 * 2026-10-25. With ES256 we verify against the JWKS *public* key: areyoubot
 * never holds a signing key, so even a leaked app secret cannot forge a token.
 *
 * `appId` is mandatory and fails closed: letmeuse signs EVERY app's tokens with
 * the SAME ES256 key, so the `app` claim is the only tenancy boundary there is.
 */
export async function verifyLetmeuseToken(
  token: string,
  deps: VerifyDeps = {},
): Promise<LetmeuseClaims | null> {
  const getKey = deps.getKey ?? getJwksPublicKeyAsync
  const appId = deps.appId ?? process.env.LETMEUSE_APP_ID ?? ''
  // Fail closed, and say so. Without our own app id we cannot check the `app`
  // claim — and would be accepting any letmeuse user from any app in the
  // ecosystem. The kit's requiredClaims would reject everything anyway, but
  // silently; "all 401s with no reason" is its own kind of outage.
  if (!appId) {
    console.error('[auth] 401: LETMEUSE_APP_ID is not set — rejecting everything (the JWKS key is shared by every app)')
    return null
  }

  const claims: Claims | null = await verifyJwtAsync(token, {
    getKey,
    algorithms: ['ES256'],
    requiredClaims: { app: appId },
    // Server-side log only. The values in `info` mostly come from the caller
    // (alg / kid / claim values) — echoing them back would be a reflected
    // information leak.
    onReject: (info) => console.warn(`[auth] 401: ${info.reason}`),
  })
  if (!claims) return null

  // The kit guarantees a non-empty string `sub`. areyoubot additionally gates
  // the admin API on `email`, so that one must be a non-empty string too.
  const email = claims.email
  const sub = claims.sub
  if (typeof email !== 'string' || !email) {
    console.warn('[auth] 401: token has no string email')
    return null
  }
  if (typeof sub !== 'string' || !sub) return null

  return {
    sub,
    email,
    ...(typeof claims.name === 'string' ? { name: claims.name } : {}),
    ...(typeof claims.role === 'string' ? { role: claims.role } : {}),
  }
}
