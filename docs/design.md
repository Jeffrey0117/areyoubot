# areyoubot — 自架 Proof-of-Work CAPTCHA 服務（設計文件）

> 日期：2026-06-13
> 狀態：設計草案，待 review
> 一句話：自架版的 reCAPTCHA / Turnstile。**零外部依賴、不用申請、隱形**。寫一次，之後愛套哪個專案就丟一行 script + 一次後端 verify。

---

## 1. 目標與非目標

### 目標
- 一個**獨立 repo**的生態系小服務（跟 letmeuse / paygate 同套路），部署在 CloudPipe。
- 宿主端整合**極簡**：前端貼一行 `<script>`，後端打一次 `/verify`。
- **完全自架**：不註冊任何第三方、不需要 API key、不打外部服務、斷網可跑。
- 對真實使用者**無感**（背景運算，零互動）。
- 擋掉「便宜的大量自動化」：垃圾註冊、撞庫、表單灌爆。

### 非目標（YAGNI）
- 不擋「鐵了心專門針對你的真人攻擊」——沒有任何 CAPTCHA 做得到，不假裝。
- 不做行為分析/風險評分（自架沒有資料網，做不好，明確不做）。
- 不做圖像/拼圖挑戰（被代解服務 + AI 視覺破解，且煩使用者）。
- 第一版不做多租戶計費、不做複雜分析圖表（只做簡單統計面板，見 §10）。

---

## 2. 機制：Proof-of-Work（PoW）

不證明「你是不是人」，而是**讓每次請求都要付出 CPU 成本**。真人過一次無感；bot 想大量灌就得付 N 倍運算，不划算。

- 難題：找一個 `nonce`，使 `SHA-256(challenge + ":" + nonce)` 的**二進位開頭有 `difficulty` 個 0 bit**。
- 期望嘗試次數 ≈ `2^difficulty`。難度可調（見 §6）。
- 解題用瀏覽器**內建 `crypto.subtle.digest`**，跑在 **Web Worker**（不卡主執行緒）。
- 驗證用 Node 內建 `crypto`（HMAC / SHA-256）。**前後端都不裝任何密碼學 library。**

---

## 3. 架構與元件

新 repo `areyoubot`（Next.js + TypeScript，對齊 letmeuse 技術棧）：

| 元件 | 說明 | 對應 letmeuse 既有 pattern |
|------|------|------|
| `GET /api/challenge` | 發一道**無狀態、HMAC 簽章**的挑戰 | — |
| `POST /api/verify` | 宿主後端驗證解答（防重放） | api-result / cors |
| `widget.js` | esbuild IIFE，背景解 PoW，自動接表單或給 callback | letmeuse SDK 打包方式 |
| 後台 `/admin` | 建 site → 拿 sitekey + secret（自己生），調難度，**簡單統計面板** | **吃狗糧：用 letmeuse 登入保護** |
| MCP tools | `areyoubot_create_site` / `list_sites` / `verify` | cloudpipe manifest |
| 儲存 | site 清單 + 驗證計數 → **selfize/selfbase**；防重放 → Redis 短期 set（無 Redis 則記憶體 fallback） | selfize / rate-limit.ts redis fallback |
| 整合文件 | 「怎麼套」+ `/integrate-areyoubot` 指令 | integrate-letmeuse |

### 命名常數
- sitekey 前綴 `ayb_`、secret 前綴 `aybsk_`
- widget 屬性 `data-ayb-sitekey`（必填）、`data-ayb-callback`（選填）、`data-ayb-difficulty`（選填覆寫）、`data-ayb-badge`（選填，`off` 可關掉「are you bot? 😏」徽章）
- 隱藏欄位名 `areyoubot-token`

---

## 4. 一次請求的完整流程

```
宿主頁 <script src=".../widget.js" data-ayb-sitekey="ayb_xxx">
   │
   ├─(1) widget 載入 → GET /api/challenge?sitekey=ayb_xxx
   │        ← { token: "<payload>.<hmac>", difficulty: N }
   │           payload = base64url({ sitekey, nonceSeed, difficulty, iat, exp })
   │           hmac    = base64url(HMAC-SHA256(payload, SERVER_SECRET))  ← server 不存任何東西
   │           challengeToken = payload + "." + hmac
   │
   ├─(2) widget 在 Web Worker 解題：
   │        找 solution 使 SHA256(challengeToken + ":" + solution) 前 N bit 為 0
   │
   ├─(3) widget 把答案塞進隱藏欄位 areyoubot-token，格式固定三段：
   │        areyoubot-token = payload + "." + hmac + "." + solution
   │        （或呼叫 data-ayb-callback 指定的 JS 函式）
   │
   ├─(4) 使用者送出表單 → 宿主「自己的後端」收到 areyoubot-token
   │
   └─(5) 宿主後端 POST /api/verify { token: "<token>.<solution>", secret: "aybsk_xxx" }
            server 檢查（token 以最後一個 "." 切出 solution，前面是 challengeToken=payload.hmac）：
              a. secret 對應的 site 存在且 payload.sitekey 相符
              b. HMAC 簽章正確（重算 HMAC(payload) 比對，沒被竄改）
              c. 未過期（exp）
              d. PoW 正確（重算 SHA256(challengeToken+":"+solution)，真的有 N 個 0 bit）
              e. 未被用過（Redis SETNX「used:<hash(challengeToken)>」TTL=到 exp；防重放）
            ← { success: true } 或 { success: false, error }
```

**無狀態設計**：challenge 用 HMAC 自簽，server 不需資料庫記每一道題。唯一短期狀態是「用過的 token」replay set（TTL = 挑戰壽命，預設 2 分鐘），保持服務極輕。

---

## 5. 介面定義

### `GET /api/challenge`
- Query：`sitekey`（必）
- 200：`{ token: string, difficulty: number, ttl: number }`
- 4xx：sitekey 不存在 / 被停用 → `{ success:false, error }`
- 有 CORS（widget 跑在宿主網域），比照 letmeuse public CORS path。

### `POST /api/verify`（server-to-server，宿主後端呼叫）
- Body：`{ token: string, secret: string }`
- 200：`{ success: boolean, error?: string, ts?: string }`
- **不開 CORS / 不可從瀏覽器呼叫**（要帶 secret）。
- 有 rate limit（比照 letmeuse rate-limit.ts，per-secret/per-IP）。

### Widget JS API（掛在 `window.areyoubot`）
- 自動模式：頁面有 `data-ayb-sitekey` 的 script → 自動找最近的 `<form>` 注入隱藏欄位，submit 前確保已解題。
- 手動模式：
  - `areyoubot.solve(): Promise<string>` — 解一題回 token，自己決定何時用。
  - `areyoubot.ready: boolean`
  - `data-ayb-callback="onSolved"` — 解完呼叫 `window.onSolved(token)`。

---

## 6. 難度與調校

- `difficulty` = 開頭 0 bit 數，期望嘗試 ≈ `2^difficulty`。
- 預設 **N=18**（一般筆電/手機約幾百毫秒，真人無感；bot 大量打就放大成本）。
- 每個 site 可在後台設自己的難度；之後可加「依風險動態調」（非第一版）。
- 參考點：N=16 很輕、N=20 開始有感（弱手機約 1 秒）。上限設 N≤24 防呆。

---

## 7. 安全細節

- **防重放**：每個解答 token 一次性（Redis SETNX，TTL 到 exp）。沒 Redis → 記憶體 set（單機足夠）。
- **防竄改**：challenge HMAC 自簽，改 difficulty/exp 會驗不過。
- **防偽造解答**：verify 端**重算 hash** 確認真的有 N 個 0，不信任 client 說「我解了」。
- **secret 不外洩**：verify 是 server-to-server，secret 絕不進 widget/前端。
- **時鐘**：exp 用 server 時間；challenge 壽命短（預設 120s）。
- **DoS 自保**：`/challenge` 與 `/verify` 都掛 rate limit（沿用 letmeuse 模式）。
- **難度上限**：擋住「site 被設成超高難度把使用者瀏覽器卡死」的誤用。

---

## 8. 整合體驗（宿主端要做的事）

前端：
```html
<form id="signup">
  <input name="email" />
  <script src="https://areyoubot.../widget.js" data-ayb-sitekey="ayb_xxx"></script>
  <button>Sign up</button>
</form>
```
後端（任何語言，一次 HTTP 呼叫）：
```
POST https://areyoubot.../api/verify
{ "token": <表單帶上來的 areyoubot-token>, "secret": "aybsk_xxx" }
→ success:true 才往下做
```

不套也沒差：沒貼 script 的專案完全不受影響。

---

## 9. 分階段（之後 writing-plans 展開）

1. **核心**：`/challenge` + `/verify` + PoW 驗算 + HMAC 簽章（無 UI，先用 test 打通）。
2. **widget.js**：Web Worker 解題 + 自動接表單 + 手動 API + 「are you bot? 😏」徽章。
3. **儲存 + 後台**：selfize/selfbase 接好 → 建 site / sitekey-secret / 難度設定；後台用 letmeuse 登入保護。
4. **統計面板**：challenge/verify 計數寫進 selfbase + 後台簡單圖表。
5. **生態系**：MCP tools + CloudPipe 部署 + `/integrate-areyoubot` 文件。
6. **加固**：rate limit、replay set、難度上限、e2e。

---

## 10. 已拍板決定（2026-06-13）

- **儲存**：site 清單 + 驗證計數用 **selfize/selfbase**（不用 JSON）。
- **後台登入**：**吃狗糧，套 letmeuse 登入**（不做單一 admin token）。
- **統計面板**：第一版**做一個簡單的**（每 site 的 challenge 發放數 / verify 成功失敗數 / 近期趨勢）。計數寫進 selfbase。
- **徽章**：widget **露出「are you bot? 😏」小徽章**（可被宿主用 `data-ayb-badge="off"` 關掉）。
