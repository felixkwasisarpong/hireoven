/**
 * Try to resolve a company directly to a harvestable ATS row using its
 * apply URL (from Dice, JSearch, or other aggregators that return direct links).
 *
 * If the apply URL is recognised by any adapter (Greenhouse, Lever, Ashby,
 * Workday, etc.), a real company row with ats_type + ats_identifier is
 * inserted and queued for immediate harvest — instead of the usual
 * name-slug placeholder that discover-tenants may never resolve.
 *
 * Returns the company id + enrolled flag if a new ATS-bearing company was
 * created; null if the URL was not recognised (caller should fall back to
 * placeholder creation).
 */

import type { Pool } from "pg"
import { detectAdapter } from "@/lib/harvester/adapters"
import { companyLogoUrlFromDomain } from "@/lib/companies/logo-url"

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
  const detected = detectAdapter(args.applyUrl)
  if (!detected) return null

  const { adapter, slug } = detected
  const atsType = adapter.name
  const careersUrl = args.applyUrl

  // Stable domain key so we don't create duplicates across runs. The ATS slug
  // (not the company's real website) is the dedup key, so when the caller knows
  // the real domain we keep it in raw_ats_config.guessed_domain for logo/display.
  const domain = `${slug}.${atsType}-discovered`

  // Logo: prefer an explicit logo from the caller, else derive from the real
  // company domain when we have one. companyLogoUrlFromDomain returns "" for
  // ATS/placeholder domains, so a synthetic domain never yields a bogus logo.
  const realDomain = args.companyDomain?.trim() || null
  const logoUrl =
    (args.logoUrl?.trim() || (realDomain ? companyLogoUrlFromDomain(realDomain) : "")) || null

  try {
    const res = await pool.query<{ id: string; enrolled: boolean }>(
      `INSERT INTO companies
         (name, domain, careers_url, logo_url, ats_type, ats_identifier,
          is_active, status, freshness_tier, discovered_via, next_harvest_at, raw_ats_config)
       VALUES ($1,$2,$3,$4,$5,$6,true,'active','tier_2',$7,now(),$8::jsonb)
       ON CONFLICT (domain) DO UPDATE
         SET ats_type        = EXCLUDED.ats_type,
             ats_identifier  = EXCLUDED.ats_identifier,
             logo_url        = COALESCE(NULLIF(companies.logo_url, ''), EXCLUDED.logo_url),
             is_active       = true,
             status          = 'active',
             freshness_tier  = CASE WHEN companies.freshness_tier = 'tier_dead' THEN 'tier_2' ELSE companies.freshness_tier END,
             next_harvest_at = CASE WHEN companies.next_harvest_at IS NULL OR companies.next_harvest_at > now() THEN now() ELSE companies.next_harvest_at END,
             updated_at      = now()
       RETURNING id, (xmax = 0) AS enrolled`,
      [
        args.companyName,
        domain,
        careersUrl,
        logoUrl,
        atsType,
        slug,
        `apply-url:${args.source}`,
        JSON.stringify({
          source: args.source,
          detected_from: args.applyUrl,
          ...(realDomain ? { guessed_domain: realDomain } : {}),
        }),
      ]
    )

    if (!res.rows[0]) return null
    return { id: res.rows[0].id, atsType, enrolled: res.rows[0].enrolled }
  } catch {
    return null
  }
}
