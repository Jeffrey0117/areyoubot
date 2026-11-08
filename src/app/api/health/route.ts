import { getJwksStats } from '@/lib/jwks-cache'

export const dynamic = 'force-dynamic'

/**
 * Health check.
 *
 * Deliberately **always 200**: when the JWKS fetch is failing, restarting this
 * service does not help (the problem is upstream), and cloudpipe's watchdog
 * probes this endpoint — a 5xx would only buy a useless restart loop.
 *
 * But the dependency's state has to be visible. areyoubot is the reason this
 * rule exists: it ran for three months with half its config missing, home page
 * and health check green the whole time, while nobody could log in and the
 * stats read 0 — which looks exactly like "no users yet". Probing `/` only
 * proves the process is alive; it proves nothing about configuration.
 *
 * ⚠️ Public response gives the MINIMUM. The full `stats()` would leak the
 * internal JWKS URL, and `lastMissKid` is a value the *caller* supplied —
 * echoing it back is a reflected information leak.
 */
export async function GET() {
  let jwks: { ok: boolean; keys: number; degraded: boolean } | { ok: false; error: string }
  try {
    const s = getJwksStats()
    jwks = { ok: s.keys > 0, keys: s.keys, degraded: s.stale }
  } catch (err) {
    // getJwksStats throws when no JWKS URL is configured at all — that is a
    // config failure worth reporting, not worth hiding behind a 500.
    jwks = { ok: false, error: 'not configured' }
    void err
  }
  return Response.json(
    { ok: true, service: 'areyoubot', jwks },
    { headers: { 'cache-control': 'no-store' } },
  )
}
