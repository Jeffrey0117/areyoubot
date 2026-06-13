import { InMemorySiteStore, type SiteStore } from '@/lib/sites'
import { SelfizeSiteStore, AREYOUBOT_SITES_COLLECTION } from '@/lib/sites-selfize'
import { sfFindOne, sfCreate } from '@/lib/selfize'

const DEMO_SITE = { sitekey: 'ayb_demo', secret: 'aybsk_demo', difficulty: 18, disabled: false }

const useSelfize = Boolean(process.env.SELFIZE_URL)

// When SELFIZE_URL is set (prod/deploy) we persist sites in selfize. Otherwise
// (local unit tests, no external DB) we fall back to the in-memory demo store so
// the existing /challenge + /verify suites keep working without network.
export const siteStore: SiteStore = useSelfize
  ? new SelfizeSiteStore()
  : new InMemorySiteStore([DEMO_SITE])

// Ensure the persistent store carries the demo site so existing demos / smoke
// tests keep working after the migration. No-op for the in-memory fallback
// (which already contains the demo site at construction).
export async function seedDemoSite(): Promise<void> {
  if (!useSelfize) return
  const store = siteStore as SelfizeSiteStore
  await store.ensureReady()
  const existing = await sfFindOne(AREYOUBOT_SITES_COLLECTION, 'sitekey', DEMO_SITE.sitekey)
  if (existing) return
  await sfCreate(AREYOUBOT_SITES_COLLECTION, { ...DEMO_SITE, label: 'demo' })
}
