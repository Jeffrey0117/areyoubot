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

// Gate an admin request: a valid letmeuse token whose email matches the
// configured admin. Missing/invalid token -> 401; valid but not admin -> 403.
export function gateAdmin(request: Request): AdminGate {
  const token = bearer(request)
  if (!token) return { ok: false, status: 401 }
  const claims = verifyLetmeuseToken(token)
  if (!claims) return { ok: false, status: 401 }
  const adminEmail = process.env.AREYOUBOT_ADMIN_EMAIL
  if (!adminEmail || claims.email !== adminEmail) return { ok: false, status: 403 }
  return { ok: true, claims }
}
