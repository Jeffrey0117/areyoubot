export interface Site {
  sitekey: string
  secret: string
  difficulty: number
  disabled: boolean
}

export interface SiteStore {
  getBySitekey(sitekey: string): Promise<Site | null>
  // ⚠️ 生產注意（Plan 3 selfbase 實作）：getBySecret 是「拿使用者帶來的 secret
  // 查 site」，等同密碼比對。InMemory 版用 `===` 線性掃描有 timing side-channel
  // （理論上洩漏 secret 前綴）。真實 store 應以 sha256(secret) 當索引鍵查表（O(1)
  // 且不洩漏 timing），或用 constant-time 比較。
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
