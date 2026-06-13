import type { Site, SiteStore } from '@/lib/sites'
import {
  sfCreateCollection,
  sfCollectionExists,
  sfFindOne,
  type SelfizeRecord,
  type SelfizeRules,
} from '@/lib/selfize'

export const AREYOUBOT_SITES_COLLECTION = 'areyoubot_sites'

// secret is confidential — rules are admin-only across the board so a public
// selfize read can never expose a site secret.
const ADMIN_ONLY: SelfizeRules = { read: 'admin', create: 'admin', update: 'admin', delete: 'admin' }

const DEFAULT_TTL_MS = 30_000

interface CacheEntry {
  readonly site: Site | null
  readonly expiresAt: number
}

interface Options {
  readonly ttlMs?: number
}

function toSite(record: SelfizeRecord): Site {
  return {
    sitekey: String(record.sitekey),
    secret: String(record.secret),
    difficulty: Number(record.difficulty),
    disabled: Boolean(record.disabled),
  }
}

// Persistent site store backed by selfize, with a short in-memory cache.
// /api/challenge and /api/verify hit getBySitekey/getBySecret on EVERY request,
// so an uncached read would mean an external DB round-trip per captcha — the
// TTL cache (default 30s) keeps the hot path off the wire while staying fresh
// enough for difficulty/disabled changes to take effect quickly.
export class SelfizeSiteStore implements SiteStore {
  private readonly ttlMs: number
  // Separate maps so a sitekey lookup and a secret lookup don't collide on key.
  private readonly bySitekey = new Map<string, CacheEntry>()
  private readonly bySecret = new Map<string, CacheEntry>()
  private ready: Promise<void> | null = null

  constructor(options: Options = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS
  }

  // Idempotent + memoised. Check existence first (selfize returns 500 — NOT 409
  // — for a duplicate collection, so we must not blindly re-create on every
  // request). If it already exists, skip create entirely; otherwise create,
  // where sfCreateCollection still swallows already-exists as a race safeguard.
  ensureReady(): Promise<void> {
    if (!this.ready) {
      this.ready = this.doEnsure().catch((err) => {
        // Let a later call retry rather than caching a permanent failure.
        this.ready = null
        throw err
      })
    }
    return this.ready
  }

  private async doEnsure(): Promise<void> {
    if (await sfCollectionExists(AREYOUBOT_SITES_COLLECTION)) return
    await sfCreateCollection({
      name: AREYOUBOT_SITES_COLLECTION,
      schema: [
        { name: 'sitekey', type: 'text', required: true },
        { name: 'secret', type: 'text', required: true },
        { name: 'difficulty', type: 'integer' },
        { name: 'disabled', type: 'boolean' },
        { name: 'label', type: 'text' },
      ],
      rules: ADMIN_ONLY,
    })
  }

  async getBySitekey(sitekey: string): Promise<Site | null> {
    return this.lookup(this.bySitekey, sitekey, 'sitekey')
  }

  async getBySecret(secret: string): Promise<Site | null> {
    return this.lookup(this.bySecret, secret, 'secret')
  }

  private async lookup(
    cache: Map<string, CacheEntry>,
    value: string,
    field: 'sitekey' | 'secret'
  ): Promise<Site | null> {
    const now = Date.now()
    const cached = cache.get(value)
    if (cached && cached.expiresAt > now) return cached.site

    const record = await sfFindOne(AREYOUBOT_SITES_COLLECTION, field, value)
    const site = record ? toSite(record) : null
    cache.set(value, { site, expiresAt: now + this.ttlMs })
    return site
  }
}
