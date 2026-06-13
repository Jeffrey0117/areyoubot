# areyoubot 核心 PoW 後端 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 做出 areyoubot 的核心 Proof-of-Work 後端：能發出無狀態簽章挑戰、能在伺服器端驗證解答（含防重放、防竄改、防偽造），純邏輯、全程 TDD。

**Architecture:** 無狀態 challenge（payload 用 server HMAC 自簽，server 不存題目）。PoW = 找 nonce 使 `SHA256(challengeToken + ":" + solution)` 開頭有 N 個 0 bit。site 查詢與 replay 紀錄都藏在介面後面（Phase 1 用記憶體實作，之後換 selfbase / Redis 不動上層）。

**Tech Stack:** Next.js 16 (App Router) + TypeScript strict + Node 內建 `crypto` + Vitest。對齊 letmeuse 既有慣例。

**設計依據：** `docs/superpowers/specs/2026-06-13-areyoubot-design.md`

**Repo 位置：** 新建 `C:\Users\jeffb\Desktop\code\workhub\areyoubot`（CloudPipe canonical dir 慣例）。
**Port（暫定）：** 4012（部署註冊時最終確認）。
**Env：** `AREYOUBOT_HMAC_SECRET`（簽 challenge 用，必填）。

---

## File Structure（Phase 1）

| 檔案 | 責任 |
|------|------|
| `src/lib/pow.ts` | PoW 數學：sha256、leading-zero-bits、`meetsPow` |
| `src/lib/challenge.ts` | challenge payload 簽章 / 驗章 / 過期判斷（HMAC，無狀態） |
| `src/lib/sites.ts` | `SiteStore` 介面 + 記憶體實作（Phase 3 換 selfbase） |
| `src/lib/replay.ts` | `ReplayStore` 介面 + 記憶體實作（Phase 6 換 Redis） |
| `src/lib/config.ts` | 讀 env（HMAC secret、預設難度、challenge 壽命） |
| `src/app/api/challenge/route.ts` | `GET /api/challenge?sitekey=` |
| `src/app/api/verify/route.ts` | `POST /api/verify { token, secret }` |
| `src/__tests__/lib/*.test.ts` | 對應單元測試 |

---

### Task 1: Repo 腳手架

**Files:**
- Create: `C:\Users\jeffb\Desktop\code\workhub\areyoubot\package.json`
- Create: `tsconfig.json`, `next.config.ts`, `vitest.config.ts`, `.gitignore`, `src/app/page.tsx`

- [ ] **Step 1: 建目錄並初始化 git**

```bash
mkdir -p "C:/Users/jeffb/Desktop/code/workhub/areyoubot"
cd "C:/Users/jeffb/Desktop/code/workhub/areyoubot"
git init
```

- [ ] **Step 2: 寫 package.json**

```json
{
  "name": "areyoubot",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev -p 4012",
    "build": "next build",
    "start": "next start -p 4012",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "next": "16.1.6",
    "react": "19.0.0",
    "react-dom": "19.0.0"
  },
  "devDependencies": {
    "@types/node": "^22",
    "@types/react": "^19",
    "typescript": "^5",
    "vitest": "^2"
  }
}
```

- [ ] **Step 3: 寫 tsconfig.json（path alias `@/`）**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "ES2022"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 4: 寫 next.config.ts、vitest.config.ts、.gitignore、最小首頁**

`next.config.ts`:
```ts
import type { NextConfig } from 'next'
const nextConfig: NextConfig = {}
export default nextConfig
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'
export default defineConfig({
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
  resolve: { alias: { '@': resolve(__dirname, 'src') } },
})
```

`.gitignore`:
```
node_modules
.next
.env
.env.*
*.tsbuildinfo
next-env.d.ts
```

`src/app/page.tsx`:
```tsx
export default function Home() {
  return <main>are you bot? 😏</main>
}
```

- [ ] **Step 5: 安裝並 commit**

```bash
pnpm install
git add -A
git commit -m "chore: scaffold areyoubot (Next.js 16 + TS + Vitest)"
```
Expected: `pnpm install` 成功、commit 完成。

---

### Task 2: PoW 數學（pow.ts）

**Files:**
- Create: `src/lib/pow.ts`
- Test: `src/__tests__/lib/pow.test.ts`

- [ ] **Step 1: 寫失敗測試**

```ts
// src/__tests__/lib/pow.test.ts
import { describe, it, expect } from 'vitest'
import { leadingZeroBits, sha256, meetsPow } from '@/lib/pow'

describe('leadingZeroBits', () => {
  it('counts a full zero byte as 8', () => {
    expect(leadingZeroBits(Uint8Array.from([0x00, 0xff]))).toBe(8)
  })
  it('counts partial bits in a byte', () => {
    expect(leadingZeroBits(Uint8Array.from([0x0f]))).toBe(4) // 00001111
    expect(leadingZeroBits(Uint8Array.from([0x80]))).toBe(0) // 10000000
    expect(leadingZeroBits(Uint8Array.from([0x00, 0x00]))).toBe(16)
  })
})

describe('meetsPow', () => {
  it('difficulty 0 always passes', () => {
    expect(meetsPow('abc', 'whatever', 0)).toBe(true)
  })
  it('accepts a brute-forced solution at difficulty 8', () => {
    let n = 0
    while (leadingZeroBits(sha256(`token:${n}`)) < 8) n++
    expect(meetsPow('token', String(n), 8)).toBe(true)
  })
  it('rejects a wrong solution at difficulty 8', () => {
    // find a nonce that does NOT meet 8 bits (the vast majority do not)
    let n = 0
    while (leadingZeroBits(sha256(`token:${n}`)) >= 8) n++
    expect(meetsPow('token', String(n), 8)).toBe(false)
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `pnpm test src/__tests__/lib/pow.test.ts`
Expected: FAIL（`@/lib/pow` 不存在）。

- [ ] **Step 3: 寫實作**

```ts
// src/lib/pow.ts
import { createHash } from 'node:crypto'

export function sha256(input: string): Buffer {
  return createHash('sha256').update(input).digest()
}

export function leadingZeroBits(buf: Uint8Array): number {
  let count = 0
  for (const byte of buf) {
    if (byte === 0) {
      count += 8
      continue
    }
    let mask = 0x80
    while (mask > 0 && (byte & mask) === 0) {
      count++
      mask >>= 1
    }
    break
  }
  return count
}

export function meetsPow(challengeToken: string, solution: string, difficulty: number): boolean {
  return leadingZeroBits(sha256(`${challengeToken}:${solution}`)) >= difficulty
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `pnpm test src/__tests__/lib/pow.test.ts`
Expected: PASS（4 個 it 全綠）。

- [ ] **Step 5: Commit**

```bash
git add src/lib/pow.ts src/__tests__/lib/pow.test.ts
git commit -m "feat(pow): sha256 leading-zero-bits PoW core"
```

---

### Task 3: 無狀態 challenge 簽章（challenge.ts）

**Files:**
- Create: `src/lib/challenge.ts`
- Test: `src/__tests__/lib/challenge.test.ts`

- [ ] **Step 1: 寫失敗測試**

```ts
// src/__tests__/lib/challenge.test.ts
import { describe, it, expect } from 'vitest'
import { signChallenge, verifyChallengeToken, type ChallengePayload } from '@/lib/challenge'

const SECRET = 'test-hmac-secret'
const base: ChallengePayload = { sitekey: 'ayb_x', nonceSeed: 'seed', difficulty: 18, iat: 1000, exp: 2000 }

describe('challenge token', () => {
  it('round-trips a valid token before expiry', () => {
    const token = signChallenge(base, SECRET)
    const got = verifyChallengeToken(token, SECRET, 1500)
    expect(got).toEqual(base)
  })
  it('rejects a tampered payload', () => {
    const token = signChallenge(base, SECRET)
    const [payload, hmac] = token.split('.')
    const tampered = `${payload}x.${hmac}`
    expect(verifyChallengeToken(tampered, SECRET, 1500)).toBeNull()
  })
  it('rejects wrong secret', () => {
    const token = signChallenge(base, SECRET)
    expect(verifyChallengeToken(token, 'other', 1500)).toBeNull()
  })
  it('rejects after expiry', () => {
    const token = signChallenge(base, SECRET)
    expect(verifyChallengeToken(token, SECRET, 2001)).toBeNull()
  })
  it('rejects malformed token', () => {
    expect(verifyChallengeToken('garbage', SECRET, 1500)).toBeNull()
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `pnpm test src/__tests__/lib/challenge.test.ts`
Expected: FAIL（模組不存在）。

- [ ] **Step 3: 寫實作**

```ts
// src/lib/challenge.ts
import { createHmac, timingSafeEqual } from 'node:crypto'

export interface ChallengePayload {
  sitekey: string
  nonceSeed: string
  difficulty: number
  iat: number
  exp: number
}

function b64url(buf: Buffer): string {
  return buf.toString('base64url')
}

function hmac(payload: string, secret: string): string {
  return b64url(createHmac('sha256', secret).update(payload).digest())
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

export function signChallenge(p: ChallengePayload, secret: string): string {
  const payload = b64url(Buffer.from(JSON.stringify(p)))
  return `${payload}.${hmac(payload, secret)}`
}

export function verifyChallengeToken(
  challengeToken: string,
  secret: string,
  now: number
): ChallengePayload | null {
  const parts = challengeToken.split('.')
  if (parts.length !== 2) return null
  const [payload, sig] = parts
  if (!safeEqual(sig, hmac(payload, secret))) return null
  let p: ChallengePayload
  try {
    p = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  if (typeof p?.exp !== 'number' || now > p.exp) return null
  return p
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `pnpm test src/__tests__/lib/challenge.test.ts`
Expected: PASS（5 個 it 全綠）。

- [ ] **Step 5: Commit**

```bash
git add src/lib/challenge.ts src/__tests__/lib/challenge.test.ts
git commit -m "feat(challenge): stateless HMAC-signed challenge token"
```

---

### Task 4: SiteStore 介面 + 記憶體實作（sites.ts）

**Files:**
- Create: `src/lib/sites.ts`
- Test: `src/__tests__/lib/sites.test.ts`

- [ ] **Step 1: 寫失敗測試**

```ts
// src/__tests__/lib/sites.test.ts
import { describe, it, expect } from 'vitest'
import { InMemorySiteStore, type Site } from '@/lib/sites'

const site: Site = { sitekey: 'ayb_1', secret: 'aybsk_1', difficulty: 18, disabled: false }

describe('InMemorySiteStore', () => {
  it('finds a site by sitekey', async () => {
    const store = new InMemorySiteStore([site])
    expect(await store.getBySitekey('ayb_1')).toEqual(site)
    expect(await store.getBySitekey('nope')).toBeNull()
  })
  it('finds a site by secret', async () => {
    const store = new InMemorySiteStore([site])
    expect(await store.getBySecret('aybsk_1')).toEqual(site)
    expect(await store.getBySecret('nope')).toBeNull()
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `pnpm test src/__tests__/lib/sites.test.ts`
Expected: FAIL。

- [ ] **Step 3: 寫實作**

```ts
// src/lib/sites.ts
export interface Site {
  sitekey: string
  secret: string
  difficulty: number
  disabled: boolean
}

export interface SiteStore {
  getBySitekey(sitekey: string): Promise<Site | null>
  getBySecret(secret: string): Promise<Site | null>
}

export class InMemorySiteStore implements SiteStore {
  constructor(private readonly sites: readonly Site[]) {}
  async getBySitekey(sitekey: string): Promise<Site | null> {
    return this.sites.find((s) => s.sitekey === sitekey) ?? null
  }
  async getBySecret(secret: string): Promise<Site | null> {
    return this.sites.find((s) => s.secret === secret) ?? null
  }
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `pnpm test src/__tests__/lib/sites.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/lib/sites.ts src/__tests__/lib/sites.test.ts
git commit -m "feat(sites): SiteStore interface + in-memory impl"
```

---

### Task 5: ReplayStore 介面 + 記憶體實作（replay.ts）

**Files:**
- Create: `src/lib/replay.ts`
- Test: `src/__tests__/lib/replay.test.ts`

- [ ] **Step 1: 寫失敗測試**

```ts
// src/__tests__/lib/replay.test.ts
import { describe, it, expect } from 'vitest'
import { InMemoryReplayStore } from '@/lib/replay'

describe('InMemoryReplayStore', () => {
  it('marks first use as fresh, second as replayed', async () => {
    const store = new InMemoryReplayStore()
    expect(await store.useOnce('key1', 9999999999999)).toBe(true)
    expect(await store.useOnce('key1', 9999999999999)).toBe(false)
  })
  it('treats different keys independently', async () => {
    const store = new InMemoryReplayStore()
    expect(await store.useOnce('a', 9999999999999)).toBe(true)
    expect(await store.useOnce('b', 9999999999999)).toBe(true)
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `pnpm test src/__tests__/lib/replay.test.ts`
Expected: FAIL。

- [ ] **Step 3: 寫實作**

```ts
// src/lib/replay.ts
export interface ReplayStore {
  // 回傳 true = 第一次使用（放行）；false = 已用過（擋）。expiresAtMs 用於記憶體清理。
  useOnce(key: string, expiresAtMs: number): Promise<boolean>
}

export class InMemoryReplayStore implements ReplayStore {
  private readonly used = new Map<string, number>()
  async useOnce(key: string, expiresAtMs: number): Promise<boolean> {
    const now = Date.now()
    for (const [k, exp] of this.used) {
      if (exp < now) this.used.delete(k)
    }
    if (this.used.has(key)) return false
    this.used.set(key, expiresAtMs)
    return true
  }
}

// 單例（Phase 6 換成 Redis 實作）
export const replayStore: ReplayStore = new InMemoryReplayStore()
```

> 註：`Date.now()` 僅用於記憶體清理，不影響驗證正確性（過期由 challenge 的 `exp` 把關）。

- [ ] **Step 4: 跑測試確認通過**

Run: `pnpm test src/__tests__/lib/replay.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/lib/replay.ts src/__tests__/lib/replay.test.ts
git commit -m "feat(replay): one-time-use ReplayStore interface + in-memory impl"
```

---

### Task 6: config.ts（讀 env）

**Files:**
- Create: `src/lib/config.ts`
- Test: `src/__tests__/lib/config.test.ts`

- [ ] **Step 1: 寫失敗測試**

```ts
// src/__tests__/lib/config.test.ts
import { describe, it, expect } from 'vitest'
import { getHmacSecret, DEFAULT_DIFFICULTY, CHALLENGE_TTL_MS, MAX_DIFFICULTY } from '@/lib/config'

describe('config', () => {
  it('reads HMAC secret from env', () => {
    process.env.AREYOUBOT_HMAC_SECRET = 'abc'
    expect(getHmacSecret()).toBe('abc')
  })
  it('throws when HMAC secret missing', () => {
    delete process.env.AREYOUBOT_HMAC_SECRET
    expect(() => getHmacSecret()).toThrow()
  })
  it('exposes sane defaults', () => {
    expect(DEFAULT_DIFFICULTY).toBe(18)
    expect(MAX_DIFFICULTY).toBe(24)
    expect(CHALLENGE_TTL_MS).toBe(120_000)
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `pnpm test src/__tests__/lib/config.test.ts`
Expected: FAIL。

- [ ] **Step 3: 寫實作**

```ts
// src/lib/config.ts
export const DEFAULT_DIFFICULTY = 18
export const MAX_DIFFICULTY = 24
export const CHALLENGE_TTL_MS = 120_000

export function getHmacSecret(): string {
  const s = process.env.AREYOUBOT_HMAC_SECRET
  if (!s) throw new Error('AREYOUBOT_HMAC_SECRET not configured')
  return s
}

export function clampDifficulty(d: number): number {
  if (!Number.isFinite(d)) return DEFAULT_DIFFICULTY
  return Math.max(1, Math.min(MAX_DIFFICULTY, Math.floor(d)))
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `pnpm test src/__tests__/lib/config.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/lib/config.ts src/__tests__/lib/config.test.ts
git commit -m "feat(config): env + difficulty/ttl constants"
```

---

### Task 7: `GET /api/challenge`

**Files:**
- Create: `src/app/api/challenge/route.ts`
- Create: `src/lib/sites-instance.ts`（提供目前的 SiteStore 單例；Phase 3 換 selfbase）
- Test: `src/__tests__/api/challenge.test.ts`

- [ ] **Step 1: 寫 site 單例（暫用記憶體種子，之後換 selfbase）**

```ts
// src/lib/sites-instance.ts
import { InMemorySiteStore, type SiteStore } from '@/lib/sites'

// Phase 3 會換成 SelfbaseSiteStore。先用 env 種一個 demo site 方便端到端測試。
export const siteStore: SiteStore = new InMemorySiteStore([
  { sitekey: 'ayb_demo', secret: 'aybsk_demo', difficulty: 18, disabled: false },
])
```

- [ ] **Step 2: 寫失敗測試**

```ts
// src/__tests__/api/challenge.test.ts
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
```

- [ ] **Step 3: 跑測試確認失敗**

Run: `pnpm test src/__tests__/api/challenge.test.ts`
Expected: FAIL（route 不存在）。

- [ ] **Step 4: 寫實作**

```ts
// src/app/api/challenge/route.ts
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
```

- [ ] **Step 5: 跑測試確認通過**

Run: `pnpm test src/__tests__/api/challenge.test.ts`
Expected: PASS（3 個 it 全綠）。

- [ ] **Step 6: Commit**

```bash
git add src/app/api/challenge src/lib/sites-instance.ts src/__tests__/api/challenge.test.ts
git commit -m "feat(api): GET /api/challenge issues signed PoW challenge"
```

---

### Task 8: `POST /api/verify`

**Files:**
- Create: `src/app/api/verify/route.ts`
- Test: `src/__tests__/api/verify.test.ts`

- [ ] **Step 1: 寫失敗測試**

```ts
// src/__tests__/api/verify.test.ts
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
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `pnpm test src/__tests__/api/verify.test.ts`
Expected: FAIL（route 不存在）。

- [ ] **Step 3: 寫實作**

```ts
// src/app/api/verify/route.ts
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

  // 用最後一個 "." 切出 solution，前面是 challengeToken（payload.hmac）
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
```

- [ ] **Step 4: 跑測試確認通過**

Run: `pnpm test src/__tests__/api/verify.test.ts`
Expected: PASS（4 個 it 全綠）。

- [ ] **Step 5: 跑全部測試 + commit**

```bash
pnpm test
git add src/app/api/verify src/__tests__/api/verify.test.ts
git commit -m "feat(api): POST /api/verify validates PoW with replay protection"
```
Expected: 全部測試綠。

---

### Task 9: 端到端煙霧測試（手動）

- [ ] **Step 1: 起 dev server**

```bash
pnpm dev
```

- [ ] **Step 2: 要一道題**

```bash
curl "http://localhost:4012/api/challenge?sitekey=ayb_demo"
```
Expected: 回 `{ token, difficulty: 18, ttl: 120000 }`。

- [ ] **Step 3: 手動解 + 驗證（用 Node 腳本）**

寫一個一次性腳本 `scripts/smoke.mjs` 解題並打 verify，確認回 `{ success: true }`，再打一次確認 replay 被擋。

```js
// scripts/smoke.mjs
import { createHash } from 'node:crypto'
const base = 'http://localhost:4012'
const lzb = (b) => { let c=0; for (const x of b){ if(x===0){c+=8;continue} let m=0x80; while(m&&!(x&m)){c++;m>>=1} break } return c }
const sha = (s) => createHash('sha256').update(s).digest()
const { token, difficulty } = await (await fetch(`${base}/api/challenge?sitekey=ayb_demo`)).json()
let n = 0; while (lzb(sha(`${token}:${n}`)) < difficulty) n++
const submitted = `${token}.${n}`
const v1 = await (await fetch(`${base}/api/verify`, { method:'POST', body: JSON.stringify({ token: submitted, secret: 'aybsk_demo' }) })).json()
const v2 = await (await fetch(`${base}/api/verify`, { method:'POST', body: JSON.stringify({ token: submitted, secret: 'aybsk_demo' }) })).json()
console.log('first:', v1, 'replay:', v2)
```

Run: `node scripts/smoke.mjs`
Expected: `first: { success: true, ... } replay: { success: false, error: 'token already used' }`

- [ ] **Step 4: Commit 煙霧腳本**

```bash
git add scripts/smoke.mjs
git commit -m "test: end-to-end PoW smoke script"
```

---

## Self-Review

- **Spec 覆蓋**：本計畫對應 spec §2(PoW)、§4(流程)、§5(challenge/verify 介面)、§6(難度 N=18 + 上限 24)、§7(防重放/防竄改/防偽造解答)。widget(§5 widget API)、selfbase(§3 儲存)、後台+登入、統計(§10)、MCP+部署(§3、§9 stage 5) → **不在本計畫**，各自後續展開。
- **Placeholder**：每步皆有實際程式碼與指令，無 TBD。
- **型別一致**：`ChallengePayload`、`Site`、`SiteStore`、`ReplayStore`、`meetsPow(challengeToken, solution, difficulty)`、`signChallenge/verifyChallengeToken` 在各 task 間簽名一致；verify 端以「最後一個點」切 `challengeToken` / `solution`，與 widget 送出格式 `payload.hmac.solution`（spec §4）一致。

---

## 後續計畫（核心綠燈後各自展開）

- **Plan 2 — widget.js**：Web Worker PoW（`crypto.subtle`）、自動接表單、`window.areyoubot` API、「are you bot? 😏」徽章；esbuild 打包。
- **Plan 3 — selfbase 儲存 + 後台**：`SelfbaseSiteStore` 取代記憶體；後台 CRUD（建 site / 難度），用 letmeuse 登入保護。
- **Plan 4 — 統計面板**：challenge/verify 計數寫 selfbase，後台簡單圖表。
- **Plan 5 — 生態系**：MCP tools、CloudPipe 註冊+部署、`/integrate-areyoubot` 文件。
- **Plan 6 — 加固**：Redis ReplayStore、rate limit、難度上限驗證、e2e。
