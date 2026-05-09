import { detectAtsFromUrl } from "@/lib/companies/detect-ats"

function safeHost(rawUrl: string): string | null {
  try {
    return new URL(rawUrl).hostname.toLowerCase()
  } catch {
    return null
  }
}

/**
 * Returns true when the job application URL appears to be hosted by a known ATS.
 * Used by job-card CTAs to decide between "Quick Apply" vs "Apply".
 */
export function isKnownAtsApplyUrl(applyUrl: string | null | undefined): boolean {
  if (!applyUrl?.trim()) return false
  if (detectAtsFromUrl(applyUrl) != null) return true

  // Backstop for ATS hosts that may be missing from the URL detector.
  const host = safeHost(applyUrl)
  if (!host) return false

  if (host === "jobs.jobvite.com" || host.endsWith(".jobvite.com")) return true
  if (host === "grnh.se" || host.endsWith(".grnh.se")) return true

  return false
}

export function getApplyCtaLabel(applyUrl: string | null | undefined): "Quick Apply" | "Apply" {
  return isKnownAtsApplyUrl(applyUrl) ? "Quick Apply" : "Apply"
}
