/**
 * Try to resolve a company directly to a harvestable ATS row using its
 * apply URL (from Dice, JSearch, or other aggregators that return direct links).
 *
 * Thin back-compat wrapper: it now backsolves the apply URL to an ATS tenant
 * (resolveApplyUrlToAtsTenant) and enrolls it (enrollTenantAsCompany). The
 * external signature is unchanged so dice-ingest / jsearch-ingest keep working.
 *
 * Behaviour change vs. the old synchronous detect-and-insert:
 *   - It now follows redirects AND validates the board has jobs before
 *     enrolling (a 404 board ⇒ returns null ⇒ caller falls back to placeholder).
 *   - logo_url / raw_ats_config enrichment is no longer set here; logos are
 *     backfilled by the dedicated logo crons/scripts. The real company domain
 *     is still threaded through as the company's `domain` when known.
 *
 * Returns the company id + enrolled flag if a company was resolved/created;
 * null if the URL could not be backsolved to a board with jobs (caller should
 * fall back to placeholder creation).
 */

import type { Pool } from "pg"
import { resolveApplyUrlToAtsTenant } from "@/lib/discovery/resolve-apply-url-to-tenant"
import { enrollTenantAsCompany } from "@/lib/discovery/enroll-tenant-as-company"

export async function enrollFromApplyUrl(
  pool: Pool,
  args: {
    companyName: string
    applyUrl: string
    companyDomain?: string | null
    logoUrl?: string | null
    source: string
  }
): Promise<{ id: string; atsType: string; enrolled: boolean } | null> {
  try {
    const resolved = await resolveApplyUrlToAtsTenant(args.applyUrl, args.source)
    if (!resolved.success || !resolved.atsType || !resolved.atsIdentifier) return null

    const result = await enrollTenantAsCompany(pool, {
      atsType: resolved.atsType,
      atsIdentifier: resolved.atsIdentifier,
      confidence: resolved.confidence,
      jobCount: resolved.jobCount,
      sourceUrl: args.applyUrl,
      sourceType: args.source,
      companyNameGuess: args.companyName?.trim() || resolved.companyNameGuess,
      domainGuess: args.companyDomain?.trim() || resolved.domainGuess,
    })

    return { id: result.companyId, atsType: result.atsType, enrolled: result.created }
  } catch {
    // Never let a discovery hiccup break the ingest loop; caller falls back.
    return null
  }
}
