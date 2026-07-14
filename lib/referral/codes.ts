import type { Pool } from "pg"

// Omit visually ambiguous chars (O/0, I/1)
const CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

export function generateReferralCode(): string {
  return Array.from(
    { length: 8 },
    () => CHARSET[Math.floor(Math.random() * CHARSET.length)]
  ).join("")
}

export async function getOrCreateReferralCode(
  pool: Pool,
  userId: string
): Promise<string> {
  // Return existing code if present
  const existing = await pool.query<{ referral_code: string }>(
    `SELECT referral_code FROM profiles WHERE id = $1 LIMIT 1`,
    [userId]
  )
  if (existing.rows[0]?.referral_code) return existing.rows[0].referral_code

  // Generate a unique code (retry on collision — extremely unlikely)
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateReferralCode()
    try {
      const result = await pool.query<{ referral_code: string }>(
        `UPDATE profiles SET referral_code = $1 WHERE id = $2 RETURNING referral_code`,
        [code, userId]
      )
      if (result.rows[0]?.referral_code) return result.rows[0].referral_code
    } catch (err: unknown) {
      // 23505 = unique_violation — try another code
      if ((err as { code?: string }).code !== "23505") throw err
    }
  }
  throw new Error("Failed to generate a unique referral code")
}

export async function getUserIdByReferralCode(
  pool: Pool,
  code: string
): Promise<string | null> {
  const result = await pool.query<{ id: string }>(
    `SELECT id FROM profiles WHERE referral_code = $1 LIMIT 1`,
    [code.toUpperCase()]
  )
  return result.rows[0]?.id ?? null
}
