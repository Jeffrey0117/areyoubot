# areyoubot

> **are you bot? 😏** — 自架版 reCAPTCHA / Cloudflare Turnstile。隱形、零外部依賴、不用申請。

areyoubot 用 **Proof-of-Work** 擋 bot：不去猜「你是不是人」，而是讓**每次請求都付出一點 CPU 成本**。真人過一次無感（背景算幾百毫秒）；機器人想灌十萬次就得付十萬倍運算，不划算就走。擋的是「便宜的大量自動化」——垃圾註冊、撞庫、灌表單。

不依賴 Google / Cloudflare，沒有圖片拼圖，使用者不用點任何東西。

🌐 **Live：** https://areyoubot.isnowfriend.com
🔑 **後台建 key：** https://areyoubot.isnowfriend.com/admin

---

## 怎麼套到你的專案（3 步）

> 最快：在你的專案裡跑 `/integrate-areyoubot`，自動完成下面三步。

### 1. 建一個 site
去 [後台](https://areyoubot.isnowfriend.com/admin) 用管理員 letmeuse 帳號登入 → 建 site → 拿到：
- `sitekey`（`ayb_xxx`）— 前端用，可公開
- `secret`（`aybsk_xxx`）— **後端驗證用，只出現一次，當機密保管**

### 2. 前端：在要保護的 `<form>` 裡放 widget
```html
<form id="signup">
  <input name="email" />
  <script src="https://areyoubot.isnowfriend.com/widget.js" data-ayb-sitekey="ayb_xxx"></script>
  <button>送出</button>
</form>
```
widget 自動：背景解 PoW（Web Worker）→ 注入隱藏欄位 `areyoubot-token` → 顯示「are you bot? 😏」徽章。送出時若還沒解完會自動等。

| 屬性 | 必填 | 說明 |
|------|------|------|
| `data-ayb-sitekey` | ✅ | 你的 sitekey |
| `data-ayb-badge="off"` | | 隱藏徽章 |
| `data-ayb-callback="fn"` | | 解完呼叫 `window.fn(token)` |

### 3. 後端：驗證（`success:true` 才放行）
```js
const res = await fetch('https://areyoubot.isnowfriend.com/api/verify', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ token: form['areyoubot-token'], secret: process.env.AREYOUBOT_SECRET }),
})
if (!(await res.json()).success) return reject('bot check failed')
```
> token 一次性（驗過作廢，防重放）、有效 2 分鐘。secret **只能在後端**。

demo 可直接試：sitekey `ayb_demo` / secret `aybsk_demo`。

---

## API

| Method | Path | 用途 | Auth |
|--------|------|------|------|
| GET | `/api/challenge?sitekey=` | 取一道簽章挑戰 → `{ token, difficulty, ttl }` | 無（公開，widget 用） |
| POST | `/api/verify` | 驗證解答 → `{ success }` | body 帶 `secret`（server-to-server） |
| POST | `/api/admin/sites` | 建 site → `{ sitekey, secret }` | letmeuse JWT（管理員） |
| GET | `/api/admin/sites` | 列 site（不含 secret） | letmeuse JWT（管理員） |
| GET | `/api/admin/stats` | 每站 challenge/verify 統計 + 近 7 天 | letmeuse JWT（管理員） |

**運作原理：** server 發一個 HMAC 自簽、無狀態的 challenge → 瀏覽器找 `nonce` 使 `SHA-256(challengeToken + ":" + nonce)` 開頭有 N 個 0 bit → 後端重算驗證 + 防重放。難度 N 預設 18（leading zero bits，範圍 1–24）。

---

## 開發

```bash
pnpm install
pnpm dev            # http://localhost:4033
pnpm test           # 133 個測試（Vitest）
pnpm build          # build:widget（esbuild）+ next build
```

**Stack：** Next.js 16 · React 19 · TypeScript（strict）· Vitest · esbuild（widget）· [Selfize](https://selfize.isnowfriend.com)（site/stats 儲存）· [LetMeUse](https://letmeuse.isnowfriend.com)（後台登入）。零執行期依賴的 widget（純 JS SHA-256，與後端 Node crypto 逐位元組相同）。

詳細設計見 [`docs/design.md`](docs/design.md)。專案層的整合與慣例見 [`CLAUDE.md`](CLAUDE.md)。

---

## 生態系

CloudPipe 自架小服務之一。相關：[LetMeUse](https://letmeuse.isnowfriend.com)（認證）· [PayGate](https://github.com/Jeffrey0117/PayGate)（訂閱）· [Selfize](https://github.com/Jeffrey0117/Selfize)（資料庫）。
