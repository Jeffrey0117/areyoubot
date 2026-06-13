import { InMemorySiteStore, type SiteStore } from '@/lib/sites'

export const siteStore: SiteStore = new InMemorySiteStore([
  { sitekey: 'ayb_demo', secret: 'aybsk_demo', difficulty: 18, disabled: false },
])
