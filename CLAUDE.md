# areyoubot

自架 **Proof-of-Work CAPTCHA** 服務（reCAPTCHA/Turnstile 的自架替代）。隱形、零外部依賴、不用申請。

## Stack
- Next.js 16 + React 19 + TypeScript (strict)
- esbuild → `public/widget.js`（零依賴 IIFE，純 JS SHA-256）
- Selfize（`selfize.isnowfriend.com`）存 site/stats；Redis 無、replay 用記憶體
- LetMeUse 後台登入（app `app_KeD453DW`）
- Vitest（133 tests）
- Port: **4033** ｜ Live: `https://areyoubot.isnowfriend.com`

## Run
```bash
pnpm dev     # 4033
pnpm test
pnpm build   # build:widget (esbuild) + next build
```

## 機制（核心）
- Server 發 **HMAC 自簽、無狀態** challenge：`challengeToken = base64url(payload).base64url(hmac)`，payload = `{sitekey,nonceSeed,difficulty,iat,exp}`，HMAC 用 `AREYOUBOT_HMAC_SECRET`。Server 不存題目。
- PoW：找 `solution` 使 **`SHA-256(challengeToken + ":" + solution)` 開頭有 `difficulty` 個 0 bit**。預設 18（範圍 1–24，`clampDifficulty` 把 0/負數→預設，防靜默關閉）。
- 提交 token 格式（三段）：`payload.hmac.solution`。verify 用**最後一個 `.`** 切出 solution。
- verify 端重算 hash（不信任 client）+ HMAC 驗章 + exp + 一次性防重放（`sha256(challengeToken)` 當 key）。

## Key Files
```
src/lib/
  pow.ts            — sha256 / leadingZeroBits / meetsPow（server 端）
  challenge.ts      — signChallenge / verifyChallengeToken（HMAC, 無狀態）
  config.ts         — env + DEFAULT_DIFFICULTY=18 / MAX=24 / TTL=120s / clampDifficulty
  sites.ts          — SiteStore 介面 + InMemorySiteStore（fallback/demo）
  sites-selfize.ts  — SelfizeSiteStore（selfize 後端 + 30s 記憶體 cache）
  sites-instance.ts — 有 SELFIZE_URL 用 selfize，否則記憶體；seedDemoSite()
  selfize.ts        — selfize REST client（idempotent ensure，吞 already-exists 500）
  replay.ts         — ReplayStore 介面 + 記憶體（⚠️ 生產要換 Redis）
  letmeuse-auth.ts  — verifyLetmeuseToken：驗 HS256 簽章（LETMEUSE_APP_SECRET）+ exp，fail-closed
  admin-auth.ts     — gateAdmin：letmeuse JWT + email===AREYOUBOT_ADMIN_EMAIL
  stats.ts          — hot-path 記憶體計數（同步、永不 throw）
  stats-flush.ts    — 30s flush 到 selfize areyoubot_stats（daily bucket upsert）
src/app/api/
  challenge/route.ts        — GET 發 challenge（CORS 開，公開）
  verify/route.ts           — POST 驗證（server-to-server，不開 CORS）
  admin/sites/route.ts      — POST 建 site / GET 列表（gateAdmin）
  admin/stats/route.ts      — GET 統計（gateAdmin）
  admin/whoami/route.ts     — GET 目前登入者 isAdmin（token-gated）
src/app/admin/page.tsx      — 後台（letmeuse 登入 + 建 key + 統計表）
src/widget/
  sha256.ts        — 純 JS SHA-256（與 Node crypto 逐位元組相同，有 cross-verify 測試）
  pow-solver.ts    — solvePow / leadingZeroBits / meetsPow（client）
  worker-source.ts — Web Worker 程式碼字串（inline Blob，單檔 bundle）
  index.ts         — widget bootstrap（讀 data-attr、解題、注入 token、徽章、window.areyoubot）
src/instrumentation.ts — boot：seedDemoSite + ensureStatsCollection + 30s flush timer
```

## API（見 README 表）
公開：`GET /api/challenge?sitekey=`、`POST /api/verify {token,secret}`。
管理（letmeuse JWT，HS256 驗簽 + admin email）：`POST/GET /api/admin/sites`、`GET /api/admin/stats`。

## Env（.env.production，部署已設）
- `AREYOUBOT_HMAC_SECRET` — 簽 challenge（必）
- `SELFIZE_URL` / `SELFIZE_TOKEN` — site/stats 儲存（沒設則 fallback 記憶體 demo）
- `LETMEUSE_APP_ID` (`app_KeD453DW`) / `LETMEUSE_APP_SECRET` — 後台驗 JWT 簽章
- `AREYOUBOT_ADMIN_EMAIL` — 唯一能進後台的 email

## 別人的專案要整合 → 用 `/integrate-areyoubot`
3 步：① 建 site 拿 sitekey+secret ② 前端 `<script src=".../widget.js" data-ayb-sitekey>` 放進 `<form>` ③ 後端 `POST /api/verify {token,secret}`，`success:true` 才放行。

## Common Mistakes
| 錯誤 | 正確 |
|------|------|
| 後端 verify 用 sitekey | 用 **secret**（`aybsk_`） |
| secret 放前端 | secret 只在後端；前端只放 sitekey |
| 只前端擋、後端不 verify | 前端可繞過，**後端一定 verify** |
| 同 token verify 兩次 | 一次性，第二次回 `token already used` |
| widget 不在 `<form>` 內 | 要在有 `<form>` 的頁面才會注入 token |
| difficulty 開很高想更安全 | 18 已夠；太高只是讓真人變慢，擋不到外包代解的 bot |
| 改 `src/widget/sha256.ts` 沒同步 worker-source | 兩份是手動複本，`worker-source.test.ts` 會抓不一致 |

## Gotchas
- **部署在 `cloudpipe/projects/areyoubot`（clone），dev 在這裡（workhub）**。改 code → push → CloudPipe 部署。`public/widget.js` 是 build 產物、已 gitignore（別 commit，否則 build 後 dirty 擋部署）。
- selfize「collection 已存在」回 **500 + already exists**（不是 409）；`selfize.ts` 已吞這個。
- letmeuse JWT **要驗 HS256 簽章**（admin endpoint 公開，只 decode 不驗 = 任何人偽造 admin email 就進得來）。`LETMEUSE_APP_SECRET` 沒設則 fail-closed。
- replay/stats 是記憶體 per-process；多實例下 stats 各自 flush（PATCH 累加，30s tick 可能 race，簡單統計可接受），replay 多實例要換 Redis。
- MCP 工具（`areyoubot_create_site/list_sites/get_stats`）定義在 `cloudpipe/data/manifests/areyoubot.json`，token 走 `auth.json` envDir → `projects/areyoubot/.env` 的 1 年 admin JWT。
