// Next.js server startup hook. Runs once when the server boots (nodejs runtime
// only). We ensure the demo site exists in the persistent store so existing
// demos / smoke checks keep working after the selfize migration. Failures are
// logged-then-swallowed so a transient selfize hiccup never blocks boot.
const FLUSH_INTERVAL_MS = 30_000

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  // Warm the JWKS public-key cache at boot.
  //
  // Verification is fail-closed, so a cold cache rejects the token it is handed.
  // The async lookup now also waits for an in-flight fetch while the cache has
  // never been populated (jwks-verify-kit 0.3.1), so a cold start no longer
  // 401s the first request even without this warm-up — but warming here still
  // removes a few hundred ms from that first request, and it is the one place
  // that can SAY something when the key fetch is broken.
  // Best-effort: if letmeuse is down we still boot, the cache retries on the
  // next miss, and the reason is visible in getJwksStats().lastError and in
  // GET /api/health.
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
