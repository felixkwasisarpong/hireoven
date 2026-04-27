/**
 * Deterministic mock scores for UI when job-match or analysis APIs
 * are unavailable. Not shown as "real" user data; replace with API values.
 */
export function placeholderMatchScore01(resumeId: string): number {
  let h = 0
  for (let i = 0; i < resumeId.length; i += 1) h = (h * 31 + resumeId.charCodeAt(i)) >>> 0
  return 0.55 + (h % 40) / 100
}

export function placeholderMatchScore100(resumeId: string): number {
  return Math.round(placeholderMatchScore01(resumeId) * 100)
}
