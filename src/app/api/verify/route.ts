import { NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { verifyChallengeToken } from '@/lib/challenge'
import { meetsPow } from '@/lib/pow'
import { siteStore } from '@/lib/sites-instance'
import { replayStore } from '@/lib/replay'
import { getHmacSecret } from '@/lib/config'

function fail(error: string, status = 200): NextResponse {
  return NextResponse.json({ success: false, error }, { status })
}

export async function POST(request: Request): Promise<NextResponse> {
  let body: { token?: unknown; secret?: unknown }
  try {
    body = await request.json()
  } catch {
    return fail('invalid json', 400)
  }
  const token = typeof body.token === 'string' ? body.token : ''
  const secret = typeof body.secret === 'string' ? body.secret : ''
  if (!token || !secret) return fail('token and secret required', 400)

  const lastDot = token.lastIndexOf('.')
  if (lastDot <= 0) return fail('malformed token')
  const challengeToken = token.slice(0, lastDot)
  const solution = token.slice(lastDot + 1)

  const site = await siteStore.getBySecret(secret)
  if (!site || site.disabled) return fail('invalid secret', 401)

  const payload = verifyChallengeToken(challengeToken, getHmacSecret(), Date.now())
  if (!payload) return fail('invalid or expired challenge')
  if (payload.sitekey !== site.sitekey) return fail('sitekey mismatch')

  if (!meetsPow(challengeToken, solution, payload.difficulty)) return fail('proof of work failed')

  const replayKey = createHash('sha256').update(challengeToken).digest('base64url')
  const fresh = await replayStore.useOnce(replayKey, payload.exp)
  if (!fresh) return fail('token already used')

  return NextResponse.json({ success: true, ts: new Date(payload.iat).toISOString() })
}
