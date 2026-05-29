// Client-safe constants for student verification UI.

/** OTP TTL — pasted to the user in the email body too. */
export const STUDENT_OTP_TTL_MIN = 15

/** Max wrong attempts per code before it's invalidated. */
export const STUDENT_OTP_MAX_ATTEMPTS = 5

/** Number of digits in the OTP. */
export const STUDENT_OTP_LENGTH = 6

/**
 * Accepts ".edu" only (US universities + many K-12 districts). Trim + lowercase
 * before calling. Pure regex check — no DNS / SheerID. Verify the user
 * actually owns the mailbox by sending an OTP to it.
 */
export function isAcademicEmail(email: string): boolean {
  const normalized = email.trim().toLowerCase()
  // Must contain @, have a domain ending in .edu, and have a local part.
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.edu$/.test(normalized)) return false
  // Reject things like ".edu" with nothing in front of it (defense in depth).
  const [, domain] = normalized.split("@")
  return Boolean(domain) && domain.length > 4 && !domain.startsWith(".")
}
