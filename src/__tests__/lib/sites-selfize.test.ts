import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { SelfizeSiteStore, AREYOUBOT_SITES_COLLECTION } from '@/lib/sites-selfize'
import type { Site } from '@/lib/sites'

// Mock the selfize client so the store is tested in isolation.
vi.mock('@/lib/selfize', () => ({
  sfCreateCollection: vi.fn().mockResolvedValue(undefined),
  sfCollectionExists: vi.fn().mockResolvedValue(false),
  sfFindOne: vi.fn(),
  sfList: vi.fn(),
  sfCreate: vi.fn(),
  sfDelete: vi.fn(),
}))

import { sfCreateCollection, sfCollectionExists, sfFindOne } from '@/lib/selfize'

const record = (over: Partial<Site> = {}) => ({
  id: 'uuid-1',
  sitekey: 'ayb_a',
  secret: 'aybsk_a',
  difficulty: 18,
  disabled: false,
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  ;(sfCollectionExists as ReturnType<typeof vi.fn>).mockResolvedValue(false)
  ;(sfCreateCollection as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('SelfizeSiteStore', () => {
  it('ensureReady creates the collection with admin-only rules when it does not exist', async () => {
    ;(sfCollectionExists as ReturnType<typeof vi.fn>).mockResolvedValue(false)
    const store = new SelfizeSiteStore()
    await store.ensureReady()
    expect(sfCreateCollection).toHaveBeenCalledTimes(1)
    const arg = (sfCreateCollection as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(arg.name).toBe(AREYOUBOT_SITES_COLLECTION)
    expect(arg.rules).toEqual({ read: 'admin', create: 'admin', update: 'admin', delete: 'admin' })
    const fieldNames = arg.schema.map((f: { name: string }) => f.name)
    expect(fieldNames).toEqual(expect.arrayContaining(['sitekey', 'secret', 'difficulty', 'disabled']))
  })

  it('ensureReady skips create when the collection already exists', async () => {
    ;(sfCollectionExists as ReturnType<typeof vi.fn>).mockResolvedValue(true)
    const store = new SelfizeSiteStore()
    await store.ensureReady()
    expect(sfCreateCollection).not.toHaveBeenCalled()
  })

  it('ensureReady does NOT throw if create reports already-exists (sfCreateCollection swallows it)', async () => {
    // even if the existence check missed, create swallows already-exists, so
    // ensureReady must resolve cleanly (this is the prod 500 already-exists bug).
    ;(sfCollectionExists as ReturnType<typeof vi.fn>).mockResolvedValue(false)
    ;(sfCreateCollection as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
    const store = new SelfizeSiteStore()
    await expect(store.ensureReady()).resolves.toBeUndefined()
  })

  it('ensureReady is memoised: a second call does not re-check / re-create', async () => {
    const store = new SelfizeSiteStore()
    await store.ensureReady()
    await store.ensureReady()
    expect(sfCollectionExists).toHaveBeenCalledTimes(1)
    expect(sfCreateCollection).toHaveBeenCalledTimes(1)
  })

  it('getBySitekey returns a normalised Site', async () => {
    ;(sfFindOne as ReturnType<typeof vi.fn>).mockResolvedValue(record())
    const store = new SelfizeSiteStore()
    const site = await store.getBySitekey('ayb_a')
    expect(site).toEqual({ sitekey: 'ayb_a', secret: 'aybsk_a', difficulty: 18, disabled: false })
  })

  it('getBySitekey returns null on miss', async () => {
    ;(sfFindOne as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    const store = new SelfizeSiteStore()
    expect(await store.getBySitekey('nope')).toBeNull()
  })

  it('getBySecret finds by the secret field', async () => {
    ;(sfFindOne as ReturnType<typeof vi.fn>).mockResolvedValue(record())
    const store = new SelfizeSiteStore()
    const site = await store.getBySecret('aybsk_a')
    expect(site?.sitekey).toBe('ayb_a')
    expect(sfFindOne).toHaveBeenCalledWith(AREYOUBOT_SITES_COLLECTION, 'secret', 'aybsk_a')
  })

  it('caches a hit: second lookup within TTL does not re-hit selfize', async () => {
    ;(sfFindOne as ReturnType<typeof vi.fn>).mockResolvedValue(record())
    const store = new SelfizeSiteStore()
    await store.getBySitekey('ayb_a')
    await store.getBySitekey('ayb_a')
    expect(sfFindOne).toHaveBeenCalledTimes(1)
  })

  it('caches a miss too (negative cache) within TTL', async () => {
    ;(sfFindOne as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    const store = new SelfizeSiteStore()
    await store.getBySitekey('nope')
    await store.getBySitekey('nope')
    expect(sfFindOne).toHaveBeenCalledTimes(1)
  })

  it('re-fetches after the TTL expires', async () => {
    vi.useFakeTimers()
    ;(sfFindOne as ReturnType<typeof vi.fn>).mockResolvedValue(record())
    const store = new SelfizeSiteStore({ ttlMs: 30_000 })
    await store.getBySitekey('ayb_a')
    vi.advanceTimersByTime(31_000)
    await store.getBySitekey('ayb_a')
    expect(sfFindOne).toHaveBeenCalledTimes(2)
  })

  it('keys the cache separately for sitekey vs secret lookups', async () => {
    ;(sfFindOne as ReturnType<typeof vi.fn>).mockResolvedValue(record())
    const store = new SelfizeSiteStore()
    await store.getBySitekey('ayb_a')
    await store.getBySecret('aybsk_a')
    expect(sfFindOne).toHaveBeenCalledTimes(2)
  })

  it('coerces difficulty/disabled types coming back from json storage', async () => {
    // selfize may round-trip integer/boolean as-is, but guard against string-ish.
    ;(sfFindOne as ReturnType<typeof vi.fn>).mockResolvedValue(
      record({ difficulty: 20 as unknown as number, disabled: true })
    )
    const store = new SelfizeSiteStore()
    const site = await store.getBySitekey('ayb_a')
    expect(site?.difficulty).toBe(20)
    expect(site?.disabled).toBe(true)
  })
})
