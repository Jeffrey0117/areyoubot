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
