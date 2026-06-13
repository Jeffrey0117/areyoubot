import { NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'
import { signChallenge } from '@/lib/challenge'
import { siteStore } from '@/lib/sites-instance'
import { getHmacSecret, CHALLENGE_TTL_MS, clampDifficulty } from '@/lib/config'

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' }

export async function OPTIONS() {
  return new NextResponse(null, { headers: CORS })
}

export async function GET(request: Request): Promise<NextResponse> {
  const sitekey = new URL(request.url).searchParams.get('sitekey')
  if (!sitekey) {
    return NextResponse.json({ success: false, error: 'sitekey required' }, { status: 400, headers: CORS })
  }
  const site = await siteStore.getBySitekey(sitekey)
  if (!site || site.disabled) {
    return NextResponse.json({ success: false, error: 'unknown sitekey' }, { status: 404, headers: CORS })
  }
  const now = Date.now()
  const difficulty = clampDifficulty(site.difficulty)
  const token = signChallenge(
    { sitekey, nonceSeed: randomBytes(12).toString('base64url'), difficulty, iat: now, exp: now + CHALLENGE_TTL_MS },
    getHmacSecret()
  )
  return NextResponse.json({ token, difficulty, ttl: CHALLENGE_TTL_MS }, { headers: CORS })
}
