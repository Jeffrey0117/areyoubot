import { NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'
import { gateAdmin } from '@/lib/admin-auth'
import { clampDifficulty, DEFAULT_DIFFICULTY } from '@/lib/config'
import { sfCreate, sfList } from '@/lib/selfize'
import { AREYOUBOT_SITES_COLLECTION, SelfizeSiteStore } from '@/lib/sites-selfize'
import { siteStore } from '@/lib/sites-instance'

// Admin-only site management. Auth: letmeuse JWT whose email === AREYOUBOT_ADMIN_EMAIL.
// This route is server-side admin tooling — no CORS, no public access.

function rnd(): string {
  return randomBytes(18).toString('base64url')
}

async function ensureCollection(): Promise<void> {
  if (siteStore instanceof SelfizeSiteStore) await siteStore.ensureReady()
}

export async function POST(request: Request): Promise<NextResponse> {
  const gate = gateAdmin(request)
  if (!gate.ok) return NextResponse.json({ error: 'unauthorized' }, { status: gate.status })

  let body: { label?: unknown; difficulty?: unknown }
  try {
    body = await request.json()
  } catch {
    body = {}
  }

  const label = typeof body.label === 'string' ? body.label.slice(0, 120) : ''
  const difficulty =
    typeof body.difficulty === 'number' ? clampDifficulty(body.difficulty) : DEFAULT_DIFFICULTY

  const sitekey = `ayb_${rnd()}`
  const secret = `aybsk_${rnd()}`

  await ensureCollection()
  await sfCreate(AREYOUBOT_SITES_COLLECTION, {
    sitekey,
    secret,
    difficulty,
    disabled: false,
    label,
  })

  // secret is returned exactly once here — never stored client-side by us,
  // never returned by GET. The admin must copy it now.
  return NextResponse.json({ sitekey, secret, difficulty, disabled: false, label })
}

export async function GET(request: Request): Promise<NextResponse> {
  const gate = gateAdmin(request)
  if (!gate.ok) return NextResponse.json({ error: 'unauthorized' }, { status: gate.status })

  await ensureCollection()
  const records = await sfList(AREYOUBOT_SITES_COLLECTION)

  // Strip secret on the way out — it must never appear in a list response.
  const sites = records.map((r) => ({
    sitekey: r.sitekey,
    difficulty: r.difficulty,
    disabled: r.disabled,
    label: r.label ?? '',
    created_at: r.created_at ?? null,
  }))

  return NextResponse.json({ sites })
}
