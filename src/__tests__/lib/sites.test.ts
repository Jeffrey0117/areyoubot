import { describe, it, expect } from 'vitest'
import { InMemorySiteStore, type Site } from '@/lib/sites'

const site: Site = { sitekey: 'ayb_1', secret: 'aybsk_1', difficulty: 18, disabled: false }

describe('InMemorySiteStore', () => {
  it('finds a site by sitekey', async () => {
    const store = new InMemorySiteStore([site])
    expect(await store.getBySitekey('ayb_1')).toEqual(site)
    expect(await store.getBySitekey('nope')).toBeNull()
  })
  it('finds a site by secret', async () => {
    const store = new InMemorySiteStore([site])
    expect(await store.getBySecret('aybsk_1')).toEqual(site)
    expect(await store.getBySecret('nope')).toBeNull()
  })
})
