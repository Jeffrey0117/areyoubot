export const DEFAULT_DIFFICULTY = 18
export const MAX_DIFFICULTY = 24
export const CHALLENGE_TTL_MS = 120_000

export function getHmacSecret(): string {
  const s = process.env.AREYOUBOT_HMAC_SECRET
  if (!s) throw new Error('AREYOUBOT_HMAC_SECRET not configured')
  return s
}

export function clampDifficulty(d: number): number {
  if (!Number.isFinite(d)) return DEFAULT_DIFFICULTY
  return Math.max(1, Math.min(MAX_DIFFICULTY, Math.floor(d)))
}
