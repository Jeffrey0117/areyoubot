import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock the selfize client so flush is tested in isolation.
vi.mock('@/lib/selfize', () => ({
  sfCreateCollection: vi.fn().mockResolvedValue(undefined),
  sfCollectionExists: vi.fn().mockResolvedValue(false),
  sfFindOne: vi.fn().mockResolvedValue(null),
  sfList: vi.fn().mockResolvedValue([]),
  sfCreate: vi.fn().mockResolvedValue({ id: 'new' }),
  sfUpdate: vi.fn().mockResolvedValue({ id: 'patched' }),
  sfDelete: vi.fn(),
}))

// Spy on the accumulator's drain so we can assert it was invoked, while still
// using the real implementation to seed deltas.
import * as stats from '@/lib/stats'
import {
  sfCreateCollection,
  sfCollectionExists,
  sfFindOne,
  sfList,
  sfCreate,
  sfUpdate,
} from '@/lib/selfize'
import { ensureStatsCollection, flushStats, AREYOUBOT_STATS_COLLECTION } from '@/lib/stats-flush'

const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  mock(sfCollectionExists).mockResolvedValue(false)
  mock(sfCreateCollection).mockResolvedValue(undefined)
  mock(sfFindOne).mockResolvedValue(null)
  mock(sfList).mockResolvedValue([])
  mock(sfCreate).mockResolvedValue({ id: 'new' })
  mock(sfUpdate).mockResolvedValue({ id: 'patched' })
  // start each test from a clean accumulator
  stats.drainDeltas()
})

describe('ensureStatsCollection', () => {
  it('creates the stats collection with admin-only rules when missing', async () => {
    mock(sfCollectionExists).mockResolvedValue(false)
    await ensureStatsCollection()
    expect(sfCreateCollection).toHaveBeenCalledTimes(1)
    const arg = mock(sfCreateCollection).mock.calls[0][0]
    expect(arg.name).toBe(AREYOUBOT_STATS_COLLECTION)
    expect(arg.rules).toEqual({ read: 'admin', create: 'admin', update: 'admin', delete: 'admin' })
    const fieldNames = arg.schema.map((f: { name: string }) => f.name)
    expect(fieldNames).toEqual(
      expect.arrayContaining(['date', 'sitekey', 'challenges', 'verify_success', 'verify_fail'])
    )
  })

  it('skips create when the collection already exists', async () => {
    mock(sfCollectionExists).mockResolvedValue(true)
    await ensureStatsCollection()
    expect(sfCreateCollection).not.toHaveBeenCalled()
  })

  it('never throws even if selfize blows up', async () => {
    mock(sfCollectionExists).mockRejectedValue(new Error('network'))
    mock(sfCreateCollection).mockRejectedValue(new Error('network'))
    await expect(ensureStatsCollection()).resolves.toBeUndefined()
  })
})

describe('flushStats', () => {
  it('drains the accumulator', async () => {
    const drainSpy = vi.spyOn(stats, 'drainDeltas')
    await flushStats('2026-06-13')
    expect(drainSpy).toHaveBeenCalledTimes(1)
    drainSpy.mockRestore()
  })

  it('does nothing (no selfize writes) when there are no deltas', async () => {
    await flushStats('2026-06-13')
    expect(sfFindOne).not.toHaveBeenCalled()
    expect(sfCreate).not.toHaveBeenCalled()
    expect(sfUpdate).not.toHaveBeenCalled()
  })

  it('creates a new bucket when none exists for date+sitekey', async () => {
    stats.recordChallenge('ayb_a')
    stats.recordVerify('ayb_a', true)
    stats.recordVerify('ayb_a', false)
    mock(sfList).mockResolvedValue([]) // nothing for this sitekey today

    await flushStats('2026-06-13')

    expect(sfCreate).toHaveBeenCalledTimes(1)
    const [coll, rec] = mock(sfCreate).mock.calls[0]
    expect(coll).toBe(AREYOUBOT_STATS_COLLECTION)
    expect(rec).toEqual({
      date: '2026-06-13',
      sitekey: 'ayb_a',
      challenges: 1,
      verify_success: 1,
      verify_fail: 1,
    })
    expect(sfUpdate).not.toHaveBeenCalled()
  })

  it('PATCHes (accumulates onto) an existing bucket for date+sitekey', async () => {
    stats.recordChallenge('ayb_a')
    stats.recordChallenge('ayb_a')
    stats.recordVerify('ayb_a', true)
    // existing bucket for today
    mock(sfList).mockResolvedValue([
      { id: 'rec-1', date: '2026-06-13', sitekey: 'ayb_a', challenges: 10, verify_success: 4, verify_fail: 2 },
    ])

    await flushStats('2026-06-13')

    expect(sfUpdate).toHaveBeenCalledTimes(1)
    const [coll, id, patch] = mock(sfUpdate).mock.calls[0]
    expect(coll).toBe(AREYOUBOT_STATS_COLLECTION)
    expect(id).toBe('rec-1')
    expect(patch).toEqual({ challenges: 12, verify_success: 5, verify_fail: 2 })
    expect(sfCreate).not.toHaveBeenCalled()
  })

  it('only matches the bucket for the SAME date (ignores other-day rows for the sitekey)', async () => {
    stats.recordChallenge('ayb_a')
    mock(sfList).mockResolvedValue([
      { id: 'old', date: '2026-06-12', sitekey: 'ayb_a', challenges: 99, verify_success: 0, verify_fail: 0 },
    ])

    await flushStats('2026-06-13')

    // no today bucket -> create, not patch
    expect(sfCreate).toHaveBeenCalledTimes(1)
    expect(sfUpdate).not.toHaveBeenCalled()
  })

  it('re-merges deltas back on a persist failure (counts are not lost)', async () => {
    stats.recordChallenge('ayb_a')
    mock(sfList).mockRejectedValue(new Error('selfize down'))
    const mergeSpy = vi.spyOn(stats, 'mergeDeltas')

    await expect(flushStats('2026-06-13')).resolves.toBeUndefined()

    // delta for ayb_a is restored so the next flush retries it
    expect(mergeSpy).toHaveBeenCalled()
    expect(stats.snapshot()['ayb_a'].challenges).toBe(1)
    mergeSpy.mockRestore()
  })

  it('never throws even if every selfize call rejects', async () => {
    stats.recordChallenge('ayb_a')
    mock(sfList).mockRejectedValue(new Error('boom'))
    mock(sfCreate).mockRejectedValue(new Error('boom'))
    mock(sfUpdate).mockRejectedValue(new Error('boom'))
    await expect(flushStats('2026-06-13')).resolves.toBeUndefined()
  })
})
