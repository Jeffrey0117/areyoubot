export const DEFAULT_DIFFICULTY = 18
export const MAX_DIFFICULTY = 24
export const CHALLENGE_TTL_MS = 120_000

export function getHmacSecret(): string {
  const s = process.env.AREYOUBOT_HMAC_SECRET
  if (!s) throw new Error('AREYOUBOT_HMAC_SECRET not configured')
  return s
}

export function clampDifficulty(d: number): number {
  // 非法或過低（含 0、負數、NaN）一律回預設難度，避免「site 設定錯誤 →
  // 難度被靜默抬成 1 → CAPTCHA 幾乎等於關閉」。合法值上限 clamp 到 MAX。
  if (!Number.isFinite(d) || d < 1) return DEFAULT_DIFFICULTY
  return Math.min(MAX_DIFFICULTY, Math.floor(d))
}
