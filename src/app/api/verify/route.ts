import { NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { verifyChallengeToken } from '@/lib/challenge'
import { meetsPow } from '@/lib/pow'
import { siteStore } from '@/lib/sites-instance'
import { replayStore } from '@/lib/replay'
import { getHmacSecret } from '@/lib/config'
import { recordVerify } from '@/lib/stats'

// HTTP status 政策（刻意分層，呼叫端可依此判斷）：
//   - 請求格式錯誤（invalid json / 缺欄位）→ 400
//   - 認證失敗（secret 不對應任何 site）→ 401
//   - 驗證業務結果（challenge 過期 / sitekey 不符 / PoW 失敗 / 重放）→ 200 + success:false
//     （比照 reCAPTCHA/Turnstile：驗證「沒通過」不是 HTTP 錯誤，看 body.success）
//
// 註：本路由是 server-to-server（宿主後端帶 secret 呼叫），刻意「不開 CORS」，
// 不該、也不能被瀏覽器跨域呼叫。
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

  // The secret is valid, so site.sitekey is the legitimate sitekey to attribute
  // every verify outcome below to. recordVerify is sync + never throws + does no
  // I/O, so it cannot change the response or its ordering.
  const payload = verifyChallengeToken(challengeToken, getHmacSecret(), Date.now())
  if (!payload) {
    recordVerify(site.sitekey, false)
    return fail('invalid or expired challenge')
  }
  if (payload.sitekey !== site.sitekey) {
    recordVerify(site.sitekey, false)
    return fail('sitekey mismatch')
  }

  if (!meetsPow(challengeToken, solution, payload.difficulty)) {
    recordVerify(site.sitekey, false)
    return fail('proof of work failed')
  }

  const replayKey = createHash('sha256').update(challengeToken).digest('base64url')
  const fresh = await replayStore.useOnce(replayKey, payload.exp)
  if (!fresh) {
    recordVerify(site.sitekey, false)
    return fail('token already used')
  }

  recordVerify(site.sitekey, true)
  return NextResponse.json({ success: true, ts: new Date(payload.iat).toISOString() })
}
