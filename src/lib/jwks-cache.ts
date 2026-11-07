// JWKS public-key cache for letmeuse ES256 tokens.
//
// Why we cache: verification is synchronous (route handlers call it inline),
// fetching is not. So we fetch in the background, keep the keys in a Map, and
// read that Map synchronously. No request ever waits on letmeuse.
//
// Why no `jose`: node's crypto takes a JWK directly
// (`createPublicKey({ format: 'jwk' })`) and verifies ES256 directly, so the
// whole thing is a few dozen lines. Zero external deps, same as before.
//
// Fail closed: if we have no key, verification fails and the request is
// rejected. We would rather lock the admin out than trust a forged token.
// But fail-closed must be *visible* — hence onError + stats(), so a
// misconfigured JWKS URL shows up in the logs instead of looking like
// "nobody is logging in today".

import crypto from 'node:crypto'

const DEFAULT_REFRESH_MS = 60 * 60 * 1000
const DEFAULT_MISS_COOLDOWN_MS = 60_000
const DEFAULT_TIMEOUT_MS = 5_000
const DEFAULT_MAX_STALE_MS = 24 * 60 * 60 * 1000

export interface JwksStats {
  readonly url: string
  readonly keys: number
  readonly lastSuccessAt: number | null
  readonly lastError: string | null
}

export interface JwksCacheOptions {
  url?: string
  fetchImpl?: typeof fetch
  refreshMs?: number
  missCooldownMs?: number
  timeoutMs?: number
  maxStaleMs?: number
  onError?: (err: Error) => void
}

/** A JWK is usable only if it is an ES256 signing key on P-256. */
function toPublicKey(jwk: Record<string, unknown>): crypto.KeyObject | null {
  if (!jwk || typeof jwk !== 'object') return null
  if (typeof jwk.kid !== 'string' || !jwk.kid) return null
  if (jwk.kty !== 'EC' || jwk.crv !== 'P-256') return null
  if (jwk.alg && jwk.alg !== 'ES256') return null
  if (jwk.use && jwk.use !== 'sig') return null
  try {
    return crypto.createPublicKey({ key: jwk as crypto.JsonWebKeyInput['key'], format: 'jwk' })
  } catch {
    return null // one bad JWK must not sink the whole set
  }
}

/**
 * Deadline for a fetch. This is not belt-and-braces: node's fetch has NO
 * default timeout, so a peer that accepts the connection and then never
 * answers leaves the promise pending forever — the in-flight guard stays set,
 * the cache never refreshes again, and every request 401s until the process is
 * restarted, with nothing in the logs. The timer is deliberately NOT unref'd:
 * an unref'd timer does not fire when nothing else keeps the event loop alive.
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  if (!(ms > 0)) return promise
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`JWKS fetch timed out after ${ms}ms`)), ms)
    promise.then(
      (v) => { clearTimeout(timer); resolve(v) },
      (e) => { clearTimeout(timer); reject(e) },
    )
  })
}

export function createJwksCache(options: JwksCacheOptions = {}) {
  const url = options.url ?? process.env.LETMEUSE_JWKS_URL ?? 'http://localhost:4006/api/jwks'
  const fetchImpl = options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args))
  const refreshMs = options.refreshMs ?? DEFAULT_REFRESH_MS
  const missCooldownMs = options.missCooldownMs ?? DEFAULT_MISS_COOLDOWN_MS
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxStaleMs = options.maxStaleMs ?? DEFAULT_MAX_STALE_MS
  const onError = options.onError ?? ((e: Error) => console.warn(`[jwks] fetch failed: ${e.message}`))

  let keysByKid = new Map<string, crypto.KeyObject>()
  let lastSuccessAt = 0
  let lastAttemptAt = 0
  let lastMissFetchAt = 0
  let lastError: Error | null = null
  let inFlight: Promise<void> | null = null
  let timer: ReturnType<typeof setInterval> | null = null

  async function doRefresh(): Promise<void> {
    try {
      const signal = timeoutMs > 0 && typeof AbortSignal?.timeout === 'function'
        ? AbortSignal.timeout(timeoutMs)
        : undefined
      const res = await withTimeout(fetchImpl(url, signal ? { signal } : undefined), timeoutMs)
      if (!res || !res.ok) throw new Error(`JWKS HTTP ${res ? res.status : 'no response'}`)
      const data = (await withTimeout(Promise.resolve(res.json()), timeoutMs)) as {
        keys?: Array<Record<string, unknown>>
      }
      if (!Array.isArray(data?.keys)) throw new Error('JWKS response malformed (keys is not an array)')
      const next = new Map<string, crypto.KeyObject>()
      for (const jwk of data.keys) {
        const key = toPublicKey(jwk)
        if (key) next.set(jwk.kid as string, key)
      }
      // A well-formed 200 is authoritative, EVEN IF EMPTY — replace wholesale.
      // Keeping the old keys on an empty response would make emergency
      // revocation useless: letmeuse pulls a leaked key, and we would keep
      // accepting tokens signed with it for weeks. Only transport failures
      // (the throws above) preserve the cache.
      keysByKid = next
      lastSuccessAt = Date.now()
      lastError = null
      if (next.size === 0) {
        lastError = new Error('JWKS has no usable ES256 key — cache cleared, all tokens will be rejected')
        try { onError(lastError) } catch { /* a broken reporter must not break this */ }
      }
    } catch (e) {
      lastError = e as Error
      try { onError(lastError) } catch { /* as above */ }
    }
  }

  function refresh(): Promise<void> {
    if (inFlight) return inFlight
    inFlight = doRefresh().finally(() => {
      inFlight = null
      lastAttemptAt = Date.now() // cooldown counts from completion, not start
    })
    return inFlight
  }

  function getKey(kid: string): crypto.KeyObject | null {
    if (typeof kid !== 'string' || !kid) return null
    const stale = maxStaleMs > 0 && lastSuccessAt > 0 && Date.now() - lastSuccessAt > maxStaleMs
    const key = stale ? undefined : keysByKid.get(kid)
    // Unknown kid (key may have just rotated) → refetch in the background, but
    // still return null for THIS call. Verification is synchronous and
    // fail-closed beats waiting on the network. Its own cooldown timer, so a
    // scheduled refresh does not wipe it.
    if (!key && !inFlight && Date.now() - lastMissFetchAt >= missCooldownMs) {
      lastMissFetchAt = Date.now()
      void refresh().finally(() => { lastMissFetchAt = Date.now() })
    }
    return key ?? null
  }

  function stats(): JwksStats {
    return {
      url,
      keys: keysByKid.size,
      lastSuccessAt: lastSuccessAt || null,
      lastError: lastError ? lastError.message : null,
    }
  }

  async function whenIdle(): Promise<void> {
    for (let i = 0; i < 10 && inFlight; i += 1) await inFlight
  }

  function start(): void {
    void refresh()
    if (refreshMs > 0 && !timer) {
      timer = setInterval(() => void refresh(), refreshMs)
      ;(timer as { unref?: () => void }).unref?.()
    }
  }

  function stop(): void {
    if (timer) { clearInterval(timer); timer = null }
  }

  void lastAttemptAt // kept for stats parity with the other services
  return { getKey, refresh, whenIdle, stats, start, stop, url }
}

// Process-wide instance used by letmeuse-auth. Lazily started so importing the
// module in a test (or at build time) does not fire a network request.
let shared: ReturnType<typeof createJwksCache> | null = null

export function getSharedJwksCache() {
  if (!shared) {
    shared = createJwksCache()
    shared.start()
  }
  return shared
}

/** Synchronous public-key lookup; null when we do not have the key. */
export function getJwksPublicKey(kid: string): crypto.KeyObject | null {
  return getSharedJwksCache().getKey(kid)
}

/** Diagnostics — so a broken JWKS URL is visible instead of silent. */
export function getJwksStats(): JwksStats {
  return getSharedJwksCache().stats()
}
