// 一次性 token 防重放。回傳 true = 第一次使用（放行）；false = 已用過（擋）。
//
// ⚠️ 生產注意（Plan 6 加固）：InMemoryReplayStore 的防護在「多實例 / 程序重啟」
// 後會歸零——同一 token 在 TTL 內可在另一 instance 重放。水平擴展前必須換成
// 共享持久層（Redis SETNX，TTL=到 challenge.exp），replay 保證才成立。
export interface ReplayStore {
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

export const replayStore: ReplayStore = new InMemoryReplayStore()
