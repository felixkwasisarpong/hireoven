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

export type ApplyVariant = "linkedin" | "autofill" | "external"

export function isLinkedInApplyUrl(applyUrl: string | null | undefined): boolean {
  const host = applyUrl ? safeHost(applyUrl) : null
  if (!host) return false
  return host === "linkedin.com" || host.endsWith(".linkedin.com")
}

/**
 * Three-way classification used by job-card Apply CTAs:
 *   - "linkedin": apply URL is on LinkedIn (no autofill possible)
 *   - "autofill": apply URL is on a known ATS the extension can autofill
 *   - "external": company career site or unknown host — opens externally
 */
export function getApplyVariant(applyUrl: string | null | undefined): ApplyVariant {
  if (isLinkedInApplyUrl(applyUrl)) return "linkedin"
  if (isKnownAtsApplyUrl(applyUrl)) return "autofill"
  return "external"
}

export function getApplyVariantLabel(variant: ApplyVariant): string {
  switch (variant) {
    case "linkedin": return "Apply on LinkedIn"
    case "autofill": return "Quick Apply"
    case "external": return "Apply"
  }
}
