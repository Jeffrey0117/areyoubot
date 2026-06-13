import { describe, it, expect } from 'vitest'
import { InMemoryReplayStore } from '@/lib/replay'

describe('InMemoryReplayStore', () => {
  it('marks first use as fresh, second as replayed', async () => {
    const store = new InMemoryReplayStore()
    expect(await store.useOnce('key1', 9999999999999)).toBe(true)
    expect(await store.useOnce('key1', 9999999999999)).toBe(false)
  })
  it('treats different keys independently', async () => {
    const store = new InMemoryReplayStore()
    expect(await store.useOnce('a', 9999999999999)).toBe(true)
    expect(await store.useOnce('b', 9999999999999)).toBe(true)
  })
})
