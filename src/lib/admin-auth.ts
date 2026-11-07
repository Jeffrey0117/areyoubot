import { timingSafeEqual } from 'node:crypto'
import { verifyLetmeuseToken, type LetmeuseClaims } from '@/lib/letmeuse-auth'

export type AdminGate =
  | { readonly ok: true; readonly claims: LetmeuseClaims }
  | { readonly ok: false; readonly status: 401 | 403 }

function bearer(request: Request): string | null {
  const header = request.headers.get('authorization') ?? request.headers.get('Authorization')
  if (!header) return null
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  return match ? match[1] : null
}

// Constant-time compare; a length mismatch is itself a non-match and
// timingSafeEqual requires equal-length buffers.
function secretEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

// Identity used when the caller is a machine (the CloudPipe gateway / MCP
// tools), not a person. It is deliberately not an email that could collide
// with a real letmeuse account.
const SERVICE_CLAIMS: LetmeuseClaims = {
  sub: 'svc_areyoubot',
  email: 'service@areyoubot.local',
  name: 'service token',
  role: 'service',
}

/**
 * Gate an admin request.
 *
 * Two accepted credentials:
 *
 * 1. `AREYOUBOT_SERVICE_TOKEN` — an opaque shared secret for machine callers
 *    (CloudPipe gateway, MCP tools `areyoubot_create_site` / `list_sites` /
 *    `get_stats`). 🔒 2026-11-07: this used to be a **self-minted 1-year HS256
 *    "user" JWT** (sub `usr_mcp_admin`). That is the wrong shape twice over —
 *    it forced the verifier to accept HS256 (so a leaked app secret = full
 *    admin forgery, the pokkit 2026-10-25 hole), and it dressed a machine up
 *    as a person. Machines get an opaque token compared in constant time; no
 *    signature verification, nothing forgeable from a leaked signing key.
 *
 * 2. A letmeuse access token (ES256, verified against the JWKS public key)
 *    whose email matches `AREYOUBOT_ADMIN_EMAIL` — this is the human path,
 *    used by the admin page.
 *
 * Missing/invalid credential -> 401; valid but not admin -> 403.
 */
export function gateAdmin(request: Request): AdminGate {
  const token = bearer(request)
  if (!token) return { ok: false, status: 401 }

  const serviceToken = process.env.AREYOUBOT_SERVICE_TOKEN
  if (serviceToken && secretEquals(token, serviceToken)) {
    return { ok: true, claims: SERVICE_CLAIMS }
  }

  const claims = verifyLetmeuseToken(token)
  if (!claims) return { ok: false, status: 401 }
  const adminEmail = process.env.AREYOUBOT_ADMIN_EMAIL
  if (!adminEmail || claims.email !== adminEmail) return { ok: false, status: 403 }
  return { ok: true, claims }
}
