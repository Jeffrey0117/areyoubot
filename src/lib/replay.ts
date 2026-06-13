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
