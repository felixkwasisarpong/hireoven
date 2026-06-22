/**
 * ATS source blocklist.
 *
 * Some "ATS boards" are not real employers — they are aggregator feeds that
 * republish other companies' jobs under a single tenant (e.g. an AI career
 * agent that lists every startup it sources for). Ingesting them attributes
 * hundreds of jobs to the wrong company. List the tenant here so neither the
 * discovery/enrollment path nor the crawl worker will (re)create or harvest it.
 *
 * Match is by (ats_type, identifier) — the stable tenant slug, e.g. the
 * `{slug}` in jobs.ashbyhq.com/{slug} or boards.greenhouse.io/{slug}.
 */

import { detectAdapter } from "@/lib/harvester/adapters"

type BlockedSource = { atsType: string; identifier: string; reason: string }

export const BLOCKED_ATS_SOURCES: BlockedSource[] = [
  {
    atsType: "ashby",
    identifier: "jack-jill-external-ats",
    reason: "Jack & Jill (jackandjill.ai) aggregator board — republishes other startups' jobs, not a real employer",
  },
]

const BLOCKED_KEYS = new Set(
  BLOCKED_ATS_SOURCES.map((s) => `${s.atsType.toLowerCase()}:${s.identifier.toLowerCase()}`)
)

/** True when this (ats_type, tenant identifier) pair is a blocked aggregator source. */
export function isBlockedAtsSource(
  atsType: string | null | undefined,
  identifier: string | null | undefined
): boolean {
  if (!atsType || !identifier) return false
  return BLOCKED_KEYS.has(`${atsType.toLowerCase()}:${identifier.toLowerCase()}`)
}

/** True when an apply/careers URL resolves to a blocked aggregator tenant. */
export function isBlockedAtsUrl(url: string | null | undefined): boolean {
  if (!url?.trim()) return false
  const detected = detectAdapter(url)
  if (!detected) return false
  return isBlockedAtsSource(detected.adapter.name, detected.slug)
}
