// letmeuse JWT verification — internal-trust pattern.
//
// We deliberately DO NOT verify the HMAC signature. This is letmeuse's own
// documented integration contract: the token is minted by letmeuse, decode the
// base64url payload only. We still enforce `exp` so a leaked token can't be
// replayed forever, and require email so the caller can authorise by identity.

export interface LetmeuseClaims {
  readonly sub: string
  readonly email: string
  readonly name?: string
  readonly role?: string
}

function decodePayload(segment: string): Record<string, unknown> | null {
  try {
    const json = Buffer.from(segment, 'base64url').toString('utf8')
    const parsed = JSON.parse(json)
    if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>
    return null
  } catch {
    return null
  }
}

export function verifyLetmeuseToken(token: string): LetmeuseClaims | null {
  if (typeof token !== 'string') return null
  const parts = token.split('.')
  if (parts.length !== 3) return null

  const payload = decodePayload(parts[1])
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
