import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('@/lib/selfize', () => ({
  sfCreateCollection: vi.fn().mockResolvedValue(undefined),
  sfFindOne: vi.fn(),
  sfCreate: vi.fn(),
  sfList: vi.fn(),
  sfDelete: vi.fn(),
}))

import { sfFindOne, sfCreate, sfCreateCollection } from '@/lib/selfize'

const OLD_ENV = { ...process.env }

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
})

afterEach(() => {
  process.env = { ...OLD_ENV }
})

describe('sites-instance', () => {
  it('uses the in-memory demo store when SELFIZE_URL is unset (tests stay green)', async () => {
    delete process.env.SELFIZE_URL
    const mod = await import('@/lib/sites-instance')
    const site = await mod.siteStore.getBySitekey('ayb_demo')
    expect(site).toEqual({ sitekey: 'ayb_demo', secret: 'aybsk_demo', difficulty: 18, disabled: false })
    // memory store must not touch selfize
    expect(sfFindOne).not.toHaveBeenCalled()
  })

  it('uses the SelfizeSiteStore when SELFIZE_URL is set', async () => {
    process.env.SELFIZE_URL = 'https://selfize.example.com'
    process.env.SELFIZE_TOKEN = 'tok'
    ;(sfFindOne as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'u', sitekey: 'ayb_real', secret: 'aybsk_real', difficulty: 20, disabled: false,
    })
    const mod = await import('@/lib/sites-instance')
    const site = await mod.siteStore.getBySitekey('ayb_real')
    expect(site?.sitekey).toBe('ayb_real')
    expect(sfFindOne).toHaveBeenCalled()
  })

  describe('seedDemoSite', () => {
    it('is a no-op for the memory store (no selfize set)', async () => {
      delete process.env.SELFIZE_URL
      const mod = await import('@/lib/sites-instance')
      await mod.seedDemoSite()
      expect(sfCreate).not.toHaveBeenCalled()
      expect(sfCreateCollection).not.toHaveBeenCalled()
    })

    it('creates the demo site in selfize when it does not exist', async () => {
      process.env.SELFIZE_URL = 'https://selfize.example.com'
      process.env.SELFIZE_TOKEN = 'tok'
      ;(sfFindOne as ReturnType<typeof vi.fn>).mockResolvedValue(null)
      const mod = await import('@/lib/sites-instance')
      await mod.seedDemoSite()
      expect(sfCreateCollection).toHaveBeenCalled() // ensureReady ran
      expect(sfCreate).toHaveBeenCalledTimes(1)
      const arg = (sfCreate as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(arg[0]).toBe('areyoubot_sites')
      expect(arg[1].sitekey).toBe('ayb_demo')
      expect(arg[1].secret).toBe('aybsk_demo')
      expect(arg[1].difficulty).toBe(18)
    })

    it('does not duplicate the demo site if it already exists', async () => {
      process.env.SELFIZE_URL = 'https://selfize.example.com'
      process.env.SELFIZE_TOKEN = 'tok'
      ;(sfFindOne as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'u', sitekey: 'ayb_demo', secret: 'aybsk_demo', difficulty: 18, disabled: false,
      })
      const mod = await import('@/lib/sites-instance')
      await mod.seedDemoSite()
      expect(sfCreate).not.toHaveBeenCalled()
    })
  })
})
