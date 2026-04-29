/**
 * Best-effort company domain for logo fallbacks when stored logo_url fails.
 * Skips known ATS hostnames so we don't show the wrong favicon.
 */
import { isAtsDomain } from "@/lib/companies/ats-domains"

export function domainFromApplyUrl(applyUrl: string | null | undefined): string | null {
  if (!applyUrl?.trim()) return null
  try {
    const host = new URL(applyUrl).hostname.replace(/^www\./, "")
    if (!host || isAtsDomain(host)) return null
    return host
  } catch {
    return null
  }
}
