/**
 * Career bridge paths.
 *
 * "You read as X — here's how to reach Y." Given the field a resume currently
 * signals (from) and a field the user wants to move toward (to), builds an
 * honest, data-grounded pivot plan:
 *
 *   - transferable — skills the target field demands that the resume already has
 *   - toBuild      — the target field's most in-demand skills the resume lacks
 *   - overlapPct   — how much the two fields' real demand overlaps (short vs long bridge)
 *   - bridgeRoles  — REAL live postings that demand BOTH fields (e.g. "ML Engineer,
 *                    Payments" bridges Fintech → AI): the concrete jobs to target
 *
 * Nothing is invented: transfer/build come from the resume vs the target field's
 * corpus demand, and bridge roles are aggregated straight from the live index.
 *
 * Server-only (pg).
 */

import type { Pool } from "pg"
import type { Resume } from "@/types"
import {
  FIELDS,
  buildPositioningBrief,
  fieldSignatureToProfile,
  type FieldProfile,
  type FieldSignature,
} from "@/lib/resume/signal"
import { getFieldProfiles } from "@/lib/resume/field-profiles"
import { sqlPublishedJob } from "@/lib/jobs/publication"
import { sqlJobLocatedInUsa } from "@/lib/jobs/usa-job-sql"
import { sqlJobSponsors } from "@/lib/jobs/sponsorship-sql"

const LOOKBACK_DAYS = 120
const TOP_BRIDGE_ROLES = 8

export interface BridgeRole {
  title: string
  count: number
  /** 0–1 fraction of these bridge postings at a sponsoring employer. */
  sponsorshipShare: number
}

export interface BridgePath {
  from: string
  fromLabel: string
  to: string
  toLabel: string
  /** Resume's current fit for the target field, 0–100. */
  targetFit: number
  /** How much the two fields' real demand overlaps, 0–100 (higher = shorter bridge). */
  overlapPct: number
  /** Target-field skills the resume already has — what carries over. */
  transferable: string[]
  /** Target-field in-demand skills the resume lacks — what to build. */
  toBuild: string[]
  /** Real live postings demanding both fields — the jobs to target next. */
  bridgeRoles: BridgeRole[]
  /** Target field's visa-sponsorship density, when known. */
  sponsorshipShare?: number
}

function seedsFor(sig: FieldSignature): string[] {
  return [...new Set([...(sig.strong ?? []), ...sig.signals])].map((s) => `%${s.toLowerCase()}%`)
}

/** Share-weighted overlap of two field profiles' skills, 0–100. */
function overlapPercent(a: FieldProfile, b: FieldProfile): number {
  const bMap = new Map(b.skills.map((s) => [s.skill, s.share]))
  let inter = 0
  let union = 0
  const seen = new Set<string>()
  for (const { skill, share } of a.skills) {
    seen.add(skill)
    union += share
    const bShare = bMap.get(skill)
    if (bShare != null) inter += Math.min(share, bShare)
  }
  for (const { skill, share } of b.skills) {
    if (!seen.has(skill)) union += share
  }
  return union > 0 ? Math.round(100 * (inter / union)) : 0
}

/**
 * Live postings that demand BOTH fields — real bridge roles. A job qualifies
 * when its title/normalized_title/skills hit a `from` seed AND a `to` seed.
 */
async function queryBridgeRoles(pool: Pool, fromSig: FieldSignature, toSig: FieldSignature): Promise<BridgeRole[]> {
  const fromSeeds = seedsFor(fromSig)
  const toSeeds = seedsFor(toSig)
  const matches = (param: string) =>
    `(j.title ILIKE ANY(${param}) OR j.normalized_title ILIKE ANY(${param})
      OR EXISTS (SELECT 1 FROM unnest(j.skills) s WHERE s ILIKE ANY(${param})))`

  const { rows } = await pool.query<{ title: string; n: number; sponsors: number }>(
    `SELECT lower(btrim(COALESCE(NULLIF(btrim(j.normalized_title), ''), j.title))) AS title,
            COUNT(*)::int AS n,
            COUNT(*) FILTER (WHERE ${sqlJobSponsors("j", { companyAlias: "c" })})::int AS sponsors
       FROM jobs j
       LEFT JOIN companies c ON c.id = j.company_id
      WHERE j.is_active = true
        AND ${sqlPublishedJob("j")}
        AND ${sqlJobLocatedInUsa("j")}
        AND j.first_detected_at > now() - interval '${LOOKBACK_DAYS} days'
        AND ${matches("$1::text[]")}
        AND ${matches("$2::text[]")}
      GROUP BY 1
      HAVING COUNT(*) >= 2
      ORDER BY n DESC
      LIMIT ${TOP_BRIDGE_ROLES}`,
    [fromSeeds, toSeeds],
  )
  return rows.map((r) => ({
    title: r.title,
    count: r.n,
    sponsorshipShare: r.n > 0 ? Math.min(1, r.sponsors / r.n) : 0,
  }))
}

/**
 * Build the bridge from `fromKey` to `toKey` for a resume. Uses corpus-derived
 * field profiles when available (else the curated signature) so it works before
 * the profiles are built and sharpens once they are.
 */
export async function computeBridgePath(
  pool: Pool,
  resume: Parameters<typeof buildPositioningBrief>[0],
  fromKey: string,
  toKey: string,
): Promise<BridgePath | null> {
  const fromSig = FIELDS.find((f) => f.key === fromKey)
  const toSig = FIELDS.find((f) => f.key === toKey)
  if (!fromSig || !toSig || fromKey === toKey) return null

  const profiles = await getFieldProfiles(pool).catch(() => [] as FieldProfile[])
  const fromProfile = profiles.find((p) => p.key === fromKey) ?? fieldSignatureToProfile(fromSig)
  const toProfile = profiles.find((p) => p.key === toKey) ?? fieldSignatureToProfile(toSig)

  // buildPositioningBrief against the TARGET field already computes exactly what
  // we need: leadWith = target skills the resume has (transferable), closeGaps =
  // target's in-demand skills it lacks (toBuild).
  const brief = buildPositioningBrief(resume, toProfile)
  const bridgeRoles = await queryBridgeRoles(pool, fromSig, toSig).catch(() => [] as BridgeRole[])

  return {
    from: fromKey,
    fromLabel: fromSig.label,
    to: toKey,
    toLabel: toSig.label,
    targetFit: brief.score,
    overlapPct: overlapPercent(fromProfile, toProfile),
    transferable: brief.leadWith,
    toBuild: brief.closeGaps,
    bridgeRoles,
    sponsorshipShare: toProfile.sponsorshipShare,
  }
}
