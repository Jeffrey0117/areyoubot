// Next.js server startup hook. Runs once when the server boots (nodejs runtime
// only). We ensure the demo site exists in the persistent store so existing
// demos / smoke checks keep working after the selfize migration. Failures are
// logged-then-swallowed so a transient selfize hiccup never blocks boot.
const FLUSH_INTERVAL_MS = 30_000

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  // Warm the JWKS public-key cache at boot.
  //
  // Verification is synchronous and fail-closed, so a cold cache rejects the
  // token it is handed and only fetches the key in the background. Without
  // this warm-up the FIRST admin request after every restart 401s even with a
  // perfectly valid token — which reads exactly like "my login is broken".
  // Awaiting one fetch here costs a few hundred ms of boot and removes the
  // whole class of problem. Best-effort: if letmeuse is down we still boot,
  // the cache retries on the next unknown-kid miss, and the reason is visible
  // in getJwksStats().lastError.
  try {
    const { getSharedJwksCache } = await import('@/lib/jwks-cache')
    const cache = getSharedJwksCache()
    await cache.refresh()
    const s = cache.stats()
    if (s.keys === 0) console.warn(`[boot] JWKS 預熱失敗（admin 登入會全部 401）: ${s.lastError ?? 'no keys'}`)
  } catch {
    // never block boot on this
  }

  try {
    const { seedDemoSite } = await import('@/lib/sites-instance')
    await seedDemoSite()
  } catch {
    // best-effort seed; the app still serves with whatever sites already exist.
  }

  // Stats persistence only runs when a selfize backend is configured. The hot
  // paths always count in memory; this timer drains those counters to selfize
  // every 30s. All best-effort: ensureStatsCollection and flushStats never throw.
  if (!process.env.SELFIZE_URL) return
  try {
    const { ensureStatsCollection, flushStats } = await import('@/lib/stats-flush')
    await ensureStatsCollection()
    const timer = setInterval(() => {
      const today = new Date().toISOString().slice(0, 10)
      void flushStats(today)
    }, FLUSH_INTERVAL_MS)
    // Don't keep the event loop alive solely for the flush timer.
    if (typeof timer.unref === 'function') timer.unref()
  } catch {
    // best-effort stats; the app serves normally without persisted stats.
  }
}
