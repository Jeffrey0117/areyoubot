import { describe, it, expect, beforeAll } from 'vitest'
import { GET } from '@/app/api/challenge/route'
import { verifyChallengeToken } from '@/lib/challenge'

beforeAll(() => { process.env.AREYOUBOT_HMAC_SECRET = 'test-secret' })

function req(url: string): Request {
  return new Request(url)
}

describe('GET /api/challenge', () => {
  it('returns a verifiable token for a known sitekey', async () => {
    const res = await GET(req('http://x/api/challenge?sitekey=ayb_demo'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.difficulty).toBe(18)
    expect(typeof body.token).toBe('string')
    const p = verifyChallengeToken(body.token, 'test-secret', Date.now())
    expect(p?.sitekey).toBe('ayb_demo')
  })
  it('404s an unknown sitekey', async () => {
    const res = await GET(req('http://x/api/challenge?sitekey=nope'))
    expect(res.status).toBe(404)
  })
  it('400s a missing sitekey', async () => {
    const res = await GET(req('http://x/api/challenge'))
    expect(res.status).toBe(400)
  })
})
