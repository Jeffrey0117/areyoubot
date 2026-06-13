// In-memory stats accumulator. /api/challenge and /api/verify are hot paths, so
// recording must be SYNCHRONOUS, never throw, and never touch external I/O. We
// only ever ++ a module-level Map of "not-yet-flushed" deltas; a separate timer
// (stats-flush) drains and persists them in the background.

export interface StatsDelta {
  readonly challenges: number
  readonly verifySuccess: number
  readonly verifyFail: number
}

interface MutableDelta {
  challenges: number
  verifySuccess: number
  verifyFail: number
}

// sitekey -> accumulated delta since the last flush.
const deltas = new Map<string, MutableDelta>()

function isValidKey(sitekey: unknown): sitekey is string {
  return typeof sitekey === 'string' && sitekey.length > 0
}

function bucketFor(sitekey: string): MutableDelta {
  let bucket = deltas.get(sitekey)
  if (!bucket) {
    bucket = { challenges: 0, verifySuccess: 0, verifyFail: 0 }
    deltas.set(sitekey, bucket)
  }
  return bucket
}

// Synchronous, never throws. A stats failure must never break the hot path.
export function recordChallenge(sitekey: string): void {
  try {
    if (!isValidKey(sitekey)) return
    bucketFor(sitekey).challenges += 1
  } catch {
    // swallow — counting must never affect the request.
  }
}

// Synchronous, never throws.
export function recordVerify(sitekey: string, ok: boolean): void {
  try {
    if (!isValidKey(sitekey)) return
    const bucket = bucketFor(sitekey)
    if (ok) bucket.verifySuccess += 1
    else bucket.verifyFail += 1
  } catch {
    // swallow.
  }
}

// Read-only view of the current un-flushed deltas (for live display). Does NOT
// reset. Returns plain immutable-ish objects keyed by sitekey.
export function snapshot(): Record<string, StatsDelta> {
  const out: Record<string, StatsDelta> = {}
  for (const [sitekey, d] of deltas) {
    out[sitekey] = { challenges: d.challenges, verifySuccess: d.verifySuccess, verifyFail: d.verifyFail }
  }
  return out
}

// Return a detached snapshot of the current deltas and reset the accumulator to
// zero. The returned Map is owned by the caller (flush) — mutating live state
// afterwards must not change it.
export function drainDeltas(): Map<string, StatsDelta> {
  const drained = new Map<string, StatsDelta>()
  for (const [sitekey, d] of deltas) {
    drained.set(sitekey, {
      challenges: d.challenges,
      verifySuccess: d.verifySuccess,
      verifyFail: d.verifyFail,
    })
  }
  deltas.clear()
  return drained
}

// Re-apply deltas back into the accumulator (used by flush to recover after a
// persist failure, so counts are not lost). Synchronous, never throws.
export function mergeDeltas(toMerge: Map<string, StatsDelta>): void {
  try {
    for (const [sitekey, d] of toMerge) {
      if (!isValidKey(sitekey)) continue
      const bucket = bucketFor(sitekey)
      bucket.challenges += d.challenges
      bucket.verifySuccess += d.verifySuccess
      bucket.verifyFail += d.verifyFail
    }
  } catch {
    // swallow.
  }
}
