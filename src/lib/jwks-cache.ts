// JWKS public-key cache — ES256 keys from letmeuse's /api/jwks.
//
// 2026-11-08: the implementation moved into `jwks-verify-kit`; what is left here
// is wiring. The ecosystem had ten independent copies of this logic and each one
// had tripped over a different half of the same pitfalls. This copy was already
// one of the better ones (timeout + Promise.race, authoritative empty response,
// independent miss cooldown), and the kit adds on top of it:
//   - a plaintext-http JWKS URL throws instead of being used (that response IS
//     the trust root — plaintext means any MITM can swap the public key and sign
//     a token for any user)
//   - a JWK carrying private key material (`d`) is rejected loudly
//   - `redirect: "error"` (a JWKS endpoint has no business redirecting)
//   - a key-count cap (createPublicKey is not cheap: 20k keys block the event
//     loop for 1.2s, and every refresh redoes it)
//   - duplicate `kid` → first one wins, instead of silently shadowing
//   - `stats()` also reports `kids` / `stale` / `lastMissKid`
//   - **cold start**: an async lookup now waits for an in-flight fetch when the
//     cache has never been populated, so the first request after a restart
//     succeeds (kit 0.3.1 — this project's own boot warm-up covers the same
//     ground, but now it is correct even without it)
import { createJwksCache as createKitCache, type JwksStats as KitStats } from 'jwks-verify-kit'
import type crypto from 'node:crypto'

export type JwksStats = KitStats

export interface JwksCacheOptions {
  url?: string
  fetchImpl?: typeof fetch
  refreshMs?: number
  missCooldownMs?: number
  timeoutMs?: number
  maxStaleMs?: number
  onError?: (err: Error) => void
}

/**
 * Resolve the JWKS URL.
 *
 * Deliberately not hardcoding a host: this repo is public, so a self-hosted
 * service address does not belong in the source. Order: explicit →
 * LETMEUSE_JWKS_URL → LETMEUSE_BASE_URL + /api/jwks.
 */
function resolveUrl(explicit?: string): string {
  if (explicit) return explicit
  if (process.env.LETMEUSE_JWKS_URL) return process.env.LETMEUSE_JWKS_URL
  const base = (process.env.LETMEUSE_BASE_URL || '').replace(/\/+$/, '')
  return base ? `${base}/api/jwks` : ''
}

export function createJwksCache(options: JwksCacheOptions = {}) {
  const url = resolveUrl(options.url)
  if (!url) {
    // Fail loudly at construction instead of silently rejecting every token.
    // areyoubot already lived through the other version of this: it ran for
    // three months with half its config missing — home page and health check
    // green the whole time, while nobody could log in and the stats read 0,
    // which looks exactly like "no users yet". See infra-map.
    throw new Error(
      'areyoubot: no JWKS URL configured (need LETMEUSE_JWKS_URL or '
      + 'LETMEUSE_BASE_URL). A verifier with no URL rejects every token while '
      + 'the service still answers 200 — that failure is the hardest to find, '
      + 'so we refuse to start instead.',
    )
  }
  return createKitCache({
    url,
    algorithms: ['ES256'],
    fetchImpl: options.fetchImpl,
    refreshMs: options.refreshMs,
    missCooldownMs: options.missCooldownMs,
    timeoutMs: options.timeoutMs,
    maxStaleMs: options.maxStaleMs,
    onError: options.onError,
  })
}

// Process-wide instance used by letmeuse-auth. Lazily started so importing the
// module in a test (or at build time) does not fire a network request.
let shared: ReturnType<typeof createJwksCache> | null = null

export function getSharedJwksCache() {
  if (!shared) {
    shared = createJwksCache()
    void shared.start()
  }
  return shared
}

/** Synchronous public-key lookup; null when we do not have the key. */
export function getJwksPublicKey(kid: string): crypto.KeyObject | null {
  return getSharedJwksCache().getKey(kid)
}

/** Async lookup — waits for one fetch on a cache miss. Prefer this in async handlers. */
export function getJwksPublicKeyAsync(kid: string): Promise<crypto.KeyObject | null> {
  return getSharedJwksCache().getKeyAsync(kid)
}

/** Diagnostics — so a broken JWKS URL is visible instead of silent. */
export function getJwksStats(): JwksStats {
  return getSharedJwksCache().stats()
}
