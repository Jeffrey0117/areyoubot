import { NextResponse } from 'next/server'
import { gateAdmin } from '@/lib/admin-auth'
import { sfList, type SelfizeRecord } from '@/lib/selfize'
import { AREYOUBOT_STATS_COLLECTION } from '@/lib/stats-flush'
import { snapshot } from '@/lib/stats'

// Admin-only stats overview. Auth: letmeuse JWT whose email === AREYOUBOT_ADMIN_EMAIL
// (same gate as /api/admin/sites). Aggregates persisted daily buckets from
// selfize and folds in the current in-memory (un-flushed) counters so the view
// is live. Never returns any secret.

interface Totals {
  challenges: number
  verifySuccess: number
  verifyFail: number
}

function zero(): Totals {
  return { challenges: 0, verifySuccess: 0, verifyFail: 0 }
}

function n(value: unknown): number {
  const num = Number(value)
  return Number.isFinite(num) ? num : 0
}

function add(into: Totals, rec: { challenges: number; verifySuccess: number; verifyFail: number }): void {
  into.challenges += rec.challenges
  into.verifySuccess += rec.verifySuccess
  into.verifyFail += rec.verifyFail
}

function recentDates(today: string, days: number): Set<string> {
  const out = new Set<string>()
  const base = new Date(`${today}T00:00:00Z`)
  for (let i = 0; i < days; i++) {
    const d = new Date(base)
    d.setUTCDate(base.getUTCDate() - i)
    out.add(d.toISOString().slice(0, 10))
  }
  return out
}

export async function GET(request: Request): Promise<NextResponse> {
  const gate = gateAdmin(request)
  if (!gate.ok) return NextResponse.json({ error: 'unauthorized' }, { status: gate.status })

  const today = new Date().toISOString().slice(0, 10)
  const window = recentDates(today, 7)

  let records: readonly SelfizeRecord[] = []
  try {
    records = await sfList(AREYOUBOT_STATS_COLLECTION)
  } catch {
    // No persisted stats yet (collection may not exist) — fall back to in-memory.
    records = []
  }

  const bySite = new Map<string, Totals>()
  const byDay = new Map<string, Totals>()

  const tallyDay = (date: string, rec: Totals): void => {
    if (!window.has(date)) return
    const day = byDay.get(date) ?? zero()
    add(day, rec)
    byDay.set(date, day)
  }
  const tallySite = (sitekey: string, rec: Totals): void => {
    const site = bySite.get(sitekey) ?? zero()
    add(site, rec)
    bySite.set(sitekey, site)
  }

  for (const r of records) {
    const sitekey = String(r.sitekey)
    const date = String(r.date)
    const rec: Totals = {
      challenges: n(r.challenges),
      verifySuccess: n(r.verify_success),
      verifyFail: n(r.verify_fail),
    }
    tallySite(sitekey, rec)
    tallyDay(date, rec)
  }

  // Fold in the live (un-flushed) counters, attributed to today.
  const live = snapshot()
  for (const [sitekey, d] of Object.entries(live)) {
    tallySite(sitekey, d)
    tallyDay(today, d)
  }

  const sites = [...bySite.entries()]
    .map(([sitekey, t]) => ({ sitekey, ...t }))
    .sort((a, b) => b.challenges - a.challenges)

  const days = [...byDay.entries()]
    .map(([date, t]) => ({ date, ...t }))
    .sort((a, b) => (a.date < b.date ? 1 : -1))

  return NextResponse.json({ sites, days })
}
