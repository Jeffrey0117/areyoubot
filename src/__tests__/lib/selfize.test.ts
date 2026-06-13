import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  sfCreateCollection,
  sfCollectionExists,
  sfList,
  sfCreate,
  sfFindOne,
  sfUpdate,
  sfDelete,
} from '@/lib/selfize'

const OLD_ENV = { ...process.env }

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  process.env.SELFIZE_URL = 'https://selfize.example.com'
  process.env.SELFIZE_TOKEN = 'test-token'
})

afterEach(() => {
  process.env = { ...OLD_ENV }
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('selfize client', () => {
  it('sfCreateCollection POSTs to /api/collections with Authorization header and body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ name: 'things' }, 201))
    vi.stubGlobal('fetch', fetchMock)

    await sfCreateCollection({
      name: 'things',
      schema: [{ name: 'sitekey', type: 'text', required: true }],
      rules: { read: 'admin', create: 'admin', update: 'admin', delete: 'admin' },
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://selfize.example.com/api/collections')
    expect(init.method).toBe('POST')
    expect(init.headers['Authorization']).toBe('Bearer test-token')
    expect(init.headers['Content-Type']).toBe('application/json')
    const body = JSON.parse(init.body)
    expect(body.name).toBe('things')
    expect(body.schema).toEqual([{ name: 'sitekey', type: 'text', required: true }])
    expect(body.rules.read).toBe('admin')
  })

  it('sfCreate POSTs a record to the collection records endpoint and returns it', async () => {
    const record = { id: 'uuid-1', sitekey: 'ayb_x', created_at: 't' }
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(record, 201))
    vi.stubGlobal('fetch', fetchMock)

    const out = await sfCreate('areyoubot_sites', { sitekey: 'ayb_x' })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://selfize.example.com/api/collections/areyoubot_sites/records')
    expect(init.method).toBe('POST')
    expect(init.headers['Authorization']).toBe('Bearer test-token')
    expect(JSON.parse(init.body)).toEqual({ sitekey: 'ayb_x' })
    expect(out).toEqual(record)
  })

  it('sfList GETs records and returns the items array', async () => {
    const items = [{ id: '1', sitekey: 'ayb_a' }, { id: '2', sitekey: 'ayb_b' }]
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items, total: 2, limit: 100, offset: 0 }))
    vi.stubGlobal('fetch', fetchMock)

    const out = await sfList('areyoubot_sites')

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://selfize.example.com/api/collections/areyoubot_sites/records')
    expect(init.method).toBe('GET')
    expect(init.headers['Authorization']).toBe('Bearer test-token')
    expect(out).toEqual(items)
  })

  it('sfFindOne builds an eq filter query and returns items[0]', async () => {
    const record = { id: '1', sitekey: 'ayb_a' }
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items: [record], total: 1, limit: 1, offset: 0 }))
    vi.stubGlobal('fetch', fetchMock)

    const out = await sfFindOne('areyoubot_sites', 'sitekey', 'ayb_a')

    const [url] = fetchMock.mock.calls[0]
    expect(url).toBe(
      'https://selfize.example.com/api/collections/areyoubot_sites/records?sitekey=eq.ayb_a&limit=1'
    )
    expect(out).toEqual(record)
  })

  it('sfFindOne returns null when no items match', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items: [], total: 0, limit: 1, offset: 0 }))
    vi.stubGlobal('fetch', fetchMock)

    const out = await sfFindOne('areyoubot_sites', 'sitekey', 'nope')
    expect(out).toBeNull()
  })

  it('sfFindOne url-encodes the filter value', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items: [], total: 0 }))
    vi.stubGlobal('fetch', fetchMock)

    await sfFindOne('c', 'email', 'a b+c@x.com')
    const [url] = fetchMock.mock.calls[0]
    expect(url).toContain('email=eq.' + encodeURIComponent('a b+c@x.com'))
  })

  it('sfUpdate PATCHes the record by id and returns it', async () => {
    const updated = { id: 'uuid-7', challenges: 5 }
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(updated, 200))
    vi.stubGlobal('fetch', fetchMock)

    const out = await sfUpdate('areyoubot_stats', 'uuid-7', { challenges: 5 })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://selfize.example.com/api/collections/areyoubot_stats/records/uuid-7')
    expect(init.method).toBe('PATCH')
    expect(init.headers['Authorization']).toBe('Bearer test-token')
    expect(JSON.parse(init.body)).toEqual({ challenges: 5 })
    expect(out).toEqual(updated)
  })

  it('sfDelete DELETEs the record by id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    await sfDelete('areyoubot_sites', 'uuid-9')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://selfize.example.com/api/collections/areyoubot_sites/records/uuid-9')
    expect(init.method).toBe('DELETE')
    expect(init.headers['Authorization']).toBe('Bearer test-token')
  })

  it('throws when SELFIZE_URL is missing', async () => {
    delete process.env.SELFIZE_URL
    vi.stubGlobal('fetch', vi.fn())
    await expect(sfList('c')).rejects.toThrow()
  })

  it('throws on non-ok responses (except create-collection conflict handled by caller)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: 'boom' }, 500))
    vi.stubGlobal('fetch', fetchMock)
    await expect(sfList('c')).rejects.toThrow()
  })

  describe('sfCreateCollection idempotency', () => {
    it('resolves (does not throw) on 409 already-exists', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(jsonResponse({ error: 'Collection "x" already exists' }, 409))
      vi.stubGlobal('fetch', fetchMock)
      await expect(
        sfCreateCollection({ name: 'x', schema: [], rules: { read: 'admin', create: 'admin', update: 'admin', delete: 'admin' } })
      ).resolves.toBeUndefined()
    })

    it('resolves on 500 whose body says "already exists" (selfize real behaviour)', async () => {
      // selfize returns 500, NOT 409, for an existing collection.
      const fetchMock = vi
        .fn()
        .mockResolvedValue(jsonResponse({ error: 'Collection "areyoubot_sites" already exists' }, 500))
      vi.stubGlobal('fetch', fetchMock)
      await expect(
        sfCreateCollection({ name: 'areyoubot_sites', schema: [], rules: { read: 'admin', create: 'admin', update: 'admin', delete: 'admin' } })
      ).resolves.toBeUndefined()
    })

    it('still throws on a genuine 500 that is not an already-exists error', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: 'internal boom' }, 500))
      vi.stubGlobal('fetch', fetchMock)
      await expect(
        sfCreateCollection({ name: 'x', schema: [], rules: { read: 'admin', create: 'admin', update: 'admin', delete: 'admin' } })
      ).rejects.toThrow()
    })
  })

  describe('sfCollectionExists', () => {
    it('returns true on a 2xx GET of the collection', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ name: 'areyoubot_sites' }, 200))
      vi.stubGlobal('fetch', fetchMock)
      const out = await sfCollectionExists('areyoubot_sites')
      expect(out).toBe(true)
      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe('https://selfize.example.com/api/collections/areyoubot_sites')
      expect(init.method).toBe('GET')
    })

    it('returns false on 404', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: 'not found' }, 404))
      vi.stubGlobal('fetch', fetchMock)
      expect(await sfCollectionExists('nope')).toBe(false)
    })

    it('returns false on other errors (so ensureReady can fall through to create)', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: 'boom' }, 500))
      vi.stubGlobal('fetch', fetchMock)
      expect(await sfCollectionExists('x')).toBe(false)
    })
  })
})
