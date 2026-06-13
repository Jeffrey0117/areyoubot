// Background persistence of the in-memory stats accumulator into selfize.
//
// This runs OFF the hot path (a boot-time setInterval, see instrumentation.ts).
// Design rules:
//   - flush must NEVER throw (a stats failure can't be allowed to crash boot or
//     a timer tick), so everything is wrapped and errors are swallowed.
//   - on a persist failure we re-merge the drained deltas back into the
//     accumulator so the counts are retried on the next flush rather than lost.
//   - one record per (date, sitekey) — a daily bucket we upsert (PATCH existing
//     or create new).

import {
  sfCreateCollection,
  sfCollectionExists,
  sfList,
  sfCreate,
  sfUpdate,
  type SelfizeRecord,
  type SelfizeRules,
} from '@/lib/selfize'
import { drainDeltas, mergeDeltas, type StatsDelta } from '@/lib/stats'

export const AREYOUBOT_STATS_COLLECTION = 'areyoubot_stats'

const ADMIN_ONLY: SelfizeRules = { read: 'admin', create: 'admin', update: 'admin', delete: 'admin' }

// Idempotent. sfCreateCollection swallows already-exists; the existence
// preflight avoids the noisy create path. Best-effort: never throws.
export async function ensureStatsCollection(): Promise<void> {
  try {
    if (await sfCollectionExists(AREYOUBOT_STATS_COLLECTION)) return
    await sfCreateCollection({
      name: AREYOUBOT_STATS_COLLECTION,
      schema: [
        { name: 'date', type: 'text', required: true },
        { name: 'sitekey', type: 'text', required: true },
        { name: 'challenges', type: 'integer' },
        { name: 'verify_success', type: 'integer' },
        { name: 'verify_fail', type: 'integer' },
      ],
      rules: ADMIN_ONLY,
    })
  } catch {
    // best-effort: a transient selfize hiccup must not break boot/flush.
  }
}

// Find today's bucket for a sitekey. selfize query filtering is single-field
// (sitekey=eq.X); we fetch the collection and filter both sitekey AND date in
// code, so we never depend on dual-filter support and never patch the wrong day.
function findBucket(
  records: readonly SelfizeRecord[],
  date: string,
  sitekey: string
): SelfizeRecord | null {
  for (const r of records) {
    if (String(r.sitekey) === sitekey && String(r.date) === date) return r
  }
  return null
}

async function upsertBucket(records: readonly SelfizeRecord[], date: string, sitekey: string, delta: StatsDelta): Promise<void> {
  const existing = findBucket(records, date, sitekey)
  if (existing) {
    await sfUpdate(AREYOUBOT_STATS_COLLECTION, String(existing.id), {
      challenges: Number(existing.challenges ?? 0) + delta.challenges,
      verify_success: Number(existing.verify_success ?? 0) + delta.verifySuccess,
      verify_fail: Number(existing.verify_fail ?? 0) + delta.verifyFail,
    })
    return
  }
  await sfCreate(AREYOUBOT_STATS_COLLECTION, {
    date,
    sitekey,
    challenges: delta.challenges,
    verify_success: delta.verifySuccess,
    verify_fail: delta.verifyFail,
  })
}

// Drain the accumulator and upsert each sitekey's daily bucket. On any failure
// for a sitekey, that sitekey's delta is merged back so it retries next tick.
// Never throws.
export async function flushStats(today: string): Promise<void> {
  const drained = drainDeltas()
  if (drained.size === 0) return

  let records: readonly SelfizeRecord[]
  try {
    records = await sfList(AREYOUBOT_STATS_COLLECTION)
  } catch {
    // Could not read existing buckets — put everything back and bail.
    mergeDeltas(drained)
    return
  }

  for (const [sitekey, delta] of drained) {
    try {
      await upsertBucket(records, today, sitekey, delta)
    } catch {
      // Persist failed for this sitekey — restore its delta for the next flush.
      mergeDeltas(new Map([[sitekey, delta]]))
    }
  }
}
