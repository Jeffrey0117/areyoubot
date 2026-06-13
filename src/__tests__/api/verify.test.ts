import { describe, it, expect, beforeAll } from 'vitest'
import { GET } from '@/app/api/challenge/route'
import { POST } from '@/app/api/verify/route'
import { leadingZeroBits, sha256 } from '@/lib/pow'

beforeAll(() => { process.env.AREYOUBOT_HMAC_SECRET = 'test-secret' })

async function getToken(): Promise<{ token: string; difficulty: number }> {
  const res = await GET(new Request('http://x/api/challenge?sitekey=ayb_demo'))
  return res.json()
}
function solve(token: string, difficulty: number): string {
  let n = 0
  while (leadingZeroBits(sha256(`${token}:${n}`)) < difficulty) n++
  return String(n)
}
function verifyReq(body: unknown): Request {
  return new Request('http://x/api/verify', { method: 'POST', body: JSON.stringify(body) })
}

describe('POST /api/verify', () => {
  it('accepts a correct solution once, rejects replay', async () => {
    const { token, difficulty } = await getToken()
    const solution = solve(token, difficulty)
    const submitted = `${token}.${solution}`

    const ok = await POST(verifyReq({ token: submitted, secret: 'aybsk_demo' }))
    expect(ok.status).toBe(200)
    expect((await ok.json()).success).toBe(true)

    const replay = await POST(verifyReq({ token: submitted, secret: 'aybsk_demo' }))
    expect((await replay.json()).success).toBe(false)
  })
  it('rejects a wrong secret', async () => {
    const { token, difficulty } = await getToken()
    const submitted = `${token}.${solve(token, difficulty)}`
    const res = await POST(verifyReq({ token: submitted, secret: 'aybsk_wrong' }))
    expect(res.status).toBe(401)
  })
  it('rejects a bad solution', async () => {
    const { token } = await getToken()
    const res = await POST(verifyReq({ token: `${token}.0`, secret: 'aybsk_demo' }))
    expect((await res.json()).success).toBe(false)
  })
  it('rejects malformed token', async () => {
    const res = await POST(verifyReq({ token: 'garbage', secret: 'aybsk_demo' }))
    expect((await res.json()).success).toBe(false)
  })
})
