// Server-only — uses pg, crypto, Resend. Importing from a client component
// will break the bundler.
import { createHash, randomInt } from "node:crypto"
import { Resend } from "resend"
import { getPostgresPool } from "@/lib/postgres/server"
import { getAlertsFromEmail } from "@/lib/email/identity"
import { logApiUsage } from "@/lib/admin/usage"
import {
  STUDENT_OTP_LENGTH,
  STUDENT_OTP_MAX_ATTEMPTS,
  STUDENT_OTP_TTL_MIN,
  isAcademicEmail,
} from "./index"

export { isAcademicEmail }

function generateCode(): string {
  // Cryptographically secure 6-digit code, zero-padded.
  return String(randomInt(0, 10 ** STUDENT_OTP_LENGTH)).padStart(STUDENT_OTP_LENGTH, "0")
}

function hashCode(code: string): string {
  return createHash("sha256").update(code, "utf8").digest("hex")
}

export type SendOtpResult =
  | { ok: true; expiresAt: string }
  | { ok: false; error: string; code: "INVALID_EMAIL" | "EMAIL_REQUIRED" | "RATE_LIMITED" | "EMAIL_DELIVERY_FAILED" | "RESEND_NOT_CONFIGURED" }

/**
 * Generates a fresh 6-digit OTP, invalidates any prior unconsumed codes for
 * this (user, email), sends the new code via Resend, and stores the hash.
 *
 * Rate-limited: only one new code may be requested per 60s per user.
 */
export async function sendStudentOtp(args: {
  userId: string
  email: string
}): Promise<SendOtpResult> {
  const rawEmail = args.email.trim().toLowerCase()
  if (!rawEmail) return { ok: false, error: "Email is required.", code: "EMAIL_REQUIRED" }
  if (!isAcademicEmail(rawEmail)) {
    return {
      ok: false,
      error: "Use a school email ending in .edu to verify your student status.",
      code: "INVALID_EMAIL",
    }
  }

  const pool = getPostgresPool()

  // Rate limit: max 1 send per 60s for this user.
  const recent = await pool.query<{ created_at: string }>(
    `SELECT created_at FROM student_verifications
     WHERE user_id = $1
     ORDER BY created_at DESC LIMIT 1`,
    [args.userId]
  )
  const lastSent = recent.rows[0]?.created_at ? new Date(recent.rows[0].created_at).getTime() : 0
  if (lastSent && Date.now() - lastSent < 60_000) {
    return {
      ok: false,
      error: "Please wait a minute before requesting another code.",
      code: "RATE_LIMITED",
    }
  }

  // Invalidate any prior codes for this user (we only honour the latest).
  await pool.query(
    `UPDATE student_verifications
     SET expires_at = now() - interval '1 second'
     WHERE user_id = $1 AND consumed_at IS NULL AND expires_at > now()`,
    [args.userId]
  )

  const code = generateCode()
  const codeHash = hashCode(code)
  const expiresAt = new Date(Date.now() + STUDENT_OTP_TTL_MIN * 60_000)

  await pool.query(
    `INSERT INTO student_verifications (user_id, email, code_hash, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [args.userId, rawEmail, codeHash, expiresAt]
  )

  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    // In dev without Resend, surface the code in the server log so QA can test.
    if (process.env.NODE_ENV !== "production") {
      console.log(`[student-verify] DEV ONLY — code for ${rawEmail}: ${code}`)
      return { ok: true, expiresAt: expiresAt.toISOString() }
    }
    return {
      ok: false,
      error: "Email service is not configured.",
      code: "RESEND_NOT_CONFIGURED",
    }
  }

  try {
    const resend = new Resend(apiKey)
    const result = await resend.emails.send({
      from: getAlertsFromEmail(),
      to: [rawEmail],
      subject: `Your Hireoven student verification code: ${code}`,
      text: [
        `Your Hireoven student verification code is: ${code}`,
        ``,
        `This code expires in ${STUDENT_OTP_TTL_MIN} minutes.`,
        ``,
        `If you didn't request this, you can safely ignore this email.`,
      ].join("\n"),
      html: `<p>Your Hireoven student verification code is:</p>
<p style="font-size:24px;font-weight:bold;letter-spacing:0.2em;margin:24px 0;font-family:ui-monospace,monospace">${code}</p>
<p style="color:#475569">This code expires in ${STUDENT_OTP_TTL_MIN} minutes.</p>
<p style="color:#94a3b8;font-size:12px">If you didn't request this, you can safely ignore this email.</p>`,
    })

    if (result.error) {
      return {
        ok: false,
        error: "We couldn't send the code to that address. Double-check it.",
        code: "EMAIL_DELIVERY_FAILED",
      }
    }

    await logApiUsage({
      service: "resend",
      operation: "student_verify_send",
      tokens_used: 0,
      cost_usd: 0,
    }).catch(() => {})

    return { ok: true, expiresAt: expiresAt.toISOString() }
  } catch (err) {
    console.error("[student-verify] Resend send error:", err)
    return {
      ok: false,
      error: "We couldn't send the code right now. Try again in a moment.",
      code: "EMAIL_DELIVERY_FAILED",
    }
  }
}

export type ConfirmOtpResult =
  | { ok: true; email: string }
  | {
      ok: false
      error: string
      code: "CODE_REQUIRED" | "NO_ACTIVE_CODE" | "CODE_EXPIRED" | "ATTEMPTS_EXCEEDED" | "CODE_INCORRECT"
    }

/**
 * Validates a submitted OTP, marks the verification consumed, and flips the
 * profile's is_student flag. Returns the verified email on success.
 */
export async function confirmStudentOtp(args: {
  userId: string
  code: string
}): Promise<ConfirmOtpResult> {
  const code = args.code.trim()
  if (!/^\d+$/.test(code) || code.length !== STUDENT_OTP_LENGTH) {
    return { ok: false, error: "Enter the 6-digit code from your email.", code: "CODE_REQUIRED" }
  }

  const pool = getPostgresPool()
  const row = await pool.query<{
    id: string
    email: string
    code_hash: string
    attempts: number
    expires_at: string
  }>(
    `SELECT id, email, code_hash, attempts, expires_at
     FROM student_verifications
     WHERE user_id = $1 AND consumed_at IS NULL
     ORDER BY created_at DESC
     LIMIT 1`,
    [args.userId]
  )
  const verification = row.rows[0]
  if (!verification) {
    return {
      ok: false,
      error: "No active code. Request a new one.",
      code: "NO_ACTIVE_CODE",
    }
  }

  const expiresAtMs = new Date(verification.expires_at).getTime()
  if (expiresAtMs < Date.now()) {
    return {
      ok: false,
      error: "That code has expired. Request a new one.",
      code: "CODE_EXPIRED",
    }
  }

  if (verification.attempts >= STUDENT_OTP_MAX_ATTEMPTS) {
    return {
      ok: false,
      error: "Too many wrong attempts. Request a new code.",
      code: "ATTEMPTS_EXCEEDED",
    }
  }

  const submittedHash = hashCode(code)
  if (submittedHash !== verification.code_hash) {
    await pool.query(
      `UPDATE student_verifications SET attempts = attempts + 1 WHERE id = $1`,
      [verification.id]
    )
    return {
      ok: false,
      error: "Incorrect code. Try again.",
      code: "CODE_INCORRECT",
    }
  }

  // Consume the row + flip the profile flag in one transaction.
  await pool.query("BEGIN")
  try {
    await pool.query(
      `UPDATE student_verifications SET consumed_at = now() WHERE id = $1`,
      [verification.id]
    )
    await pool.query(
      `UPDATE profiles
       SET is_student = true,
           student_email = $1,
           student_verified_at = now(),
           updated_at = now()
       WHERE id = $2`,
      [verification.email, args.userId]
    )
    await pool.query("COMMIT")
  } catch (err) {
    await pool.query("ROLLBACK")
    throw err
  }

  return { ok: true, email: verification.email }
}

export type StudentStatus = {
  isStudent: boolean
  email: string | null
  verifiedAt: string | null
}

export async function getStudentStatus(userId: string): Promise<StudentStatus> {
  const pool = getPostgresPool()
  const result = await pool.query<{
    is_student: boolean
    student_email: string | null
    student_verified_at: string | null
  }>(
    `SELECT is_student, student_email, student_verified_at
     FROM profiles
     WHERE id = $1`,
    [userId]
  )
  const row = result.rows[0]
  return {
    isStudent: row?.is_student ?? false,
    email: row?.student_email ?? null,
    verifiedAt: row?.student_verified_at ?? null,
  }
}
