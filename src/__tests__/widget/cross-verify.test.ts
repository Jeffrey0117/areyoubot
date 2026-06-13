import { describe, it, expect, beforeAll } from 'vitest'
import { GET } from '@/app/api/challenge/route'
import { POST } from '@/app/api/verify/route'
import { solvePow } from '@/widget/pow-solver'

// The whole point of the widget: a PoW solution found by our pure-JS SHA-256
// must verify against the server, which uses Node's native crypto SHA-256.
// This proves byte-for-byte digest compatibility end-to-end through the real
// challenge + verify routes.
beforeAll(() => {
  process.env.AREYOUBOT_HMAC_SECRET = 'cross-verify-test-secret'
})

async function issueChallenge(): Promise<{ token: string; difficulty: number }> {
  const res = await GET(new Request('http://x/api/challenge?sitekey=ayb_demo'))
  const body = (await res.json()) as { token: string; difficulty: number }
  return body
}

function verifyReq(body: unknown): Request {
  return new Request('http://x/api/verify', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

describe('widget <-> server cross-verification', () => {
  it(
    'solves a real challenge with widget sha256 and the server accepts it',
    async () => {
      const { token, difficulty } = await issueChallenge()
      const solution = solvePow(token, difficulty)
      const fullToken = `${token}.${solution}`

      const res = await POST(verifyReq({ token: fullToken, secret: 'aybsk_demo' }))
      const body = (await res.json()) as { success: boolean; error?: string }

      expect(res.status).toBe(200)
      expect(body.success).toBe(true)
    },
    60_000
  )

  it(
    'a second fresh challenge also verifies (digest compatibility is stable)',
    async () => {
      const { token, difficulty } = await issueChallenge()
      const fullToken = `${token}.${solvePow(token, difficulty)}`

      const res = await POST(verifyReq({ token: fullToken, secret: 'aybsk_demo' }))
      expect((await res.json()).success).toBe(true)
    },
    60_000
  )
})
