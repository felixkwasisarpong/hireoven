/**
 * Choosing what overnight auto-apply will actually apply to.
 *
 * Eligibility is deliberately narrow, because the failure mode is not "we
 * applied to too few jobs" — it is "we sent a real application, in the user's
 * name, to somewhere they would not have chosen". Every filter here fails
 * closed.
 *
 * The pool is not the constraint. Tier-1 fillable postings run ~42k/week
 * against a cap in the tens, so the caps bind long before supply does and there
 * is no reason to loosen a filter to find volume.
 */

import { getPostgresPool } from "@/lib/postgres/server"
import { classifyApplyMethod } from "@/lib/jobs/apply-method"

/** Measured 100% DataDome-blocked from a datacenter browser (Phase 1, n=22). */
const BLOCKED_ATS_HOSTS = /smartrecruiters\.com/i

/**
 * Measured required-field coverage per ATS on live postings (Phase 2, fixed
 * job set): JazzHR 100%, Ashby 100%, Lever 94%, Greenhouse 54%.
 *
 * Greenhouse is excluded by default despite being the largest Tier-1 source.
 * Its gap is react-select comboboxes that do not register a selection, so a run
 * there would reliably stop at a form it cannot complete. Better to skip it
 * than to burn a slot and report a failure — re-enable per environment once the
 * combobox driver lands.
 */
const PROVEN_ATS = new Set(["lever", "ashby", "jazzhr", "bamboohr"])

export type AutoApplyCandidate = {
  jobId: string
  title: string
  companyName: string | null
  applyUrl: string
  ats: string
  matchScore: number | null
  firstDetectedAt: string
}

export type CandidateFilters = {
  minMatchScore: number
  /** Hard ceiling on rows returned; the caller applies the real caps. */
  limit: number
  /** Allow ATS whose fill rate is not yet proven (Greenhouse). Off by default. */
  includeUnproven?: boolean
  requireSponsorshipSignal?: boolean
}

function atsOf(applyUrl: string): string {
  const host = applyUrl.split("/")[2] ?? ""
  for (const key of ["lever", "ashby", "jazzhr", "applytojob", "bamboohr",
                     "greenhouse", "workable", "breezy", "recruitee"]) {
    if (host.includes(key)) return key === "applytojob" ? "jazzhr" : key
  }
  return "unknown"
}

/**
 * Eligible postings for one user, best match first.
 *
 * Excluded in SQL because it is cheap there: stale postings, jobs the user has
 * already applied to or auto-applied to, and anything without an apply URL.
 * Excluded in TypeScript because the rules are tested there: apply-method
 * classification, the blocked-ATS list, and the proven-ATS gate.
 */
export async function getAutoApplyCandidates(
  userId: string,
  filters: CandidateFilters,
): Promise<AutoApplyCandidate[]> {
  const pool = getPostgresPool()

  const { rows } = await pool.query<{
    job_id: string
    title: string
    company_name: string | null
    apply_url: string
    ats_type: string | null
    match_score: string | null
    first_detected_at: string
  }>(
    `SELECT j.id            AS job_id,
            j.title,
            c.name          AS company_name,
            j.apply_url,
            c.ats_type,
            ms.overall_score AS match_score,
            j.first_detected_at
       FROM jobs j
       LEFT JOIN companies c   ON c.id = j.company_id
       -- job_match_scores can hold several rows per (user, job) — one per
       -- résumé version — so take the best rather than fanning the join out and
       -- returning the same posting repeatedly.
       LEFT JOIN LATERAL (
         SELECT overall_score
           FROM job_match_scores
          WHERE job_id = j.id AND user_id = $1
          ORDER BY computed_at DESC
          LIMIT 1
       ) ms ON true
      WHERE j.is_active
        AND j.apply_url IS NOT NULL
        -- Freshness is a quality filter as much as a relevance one: a posting
        -- older than two weeks is far more likely to be filled or stale.
        AND j.first_detected_at > now() - interval '14 days'
        AND COALESCE(ms.overall_score, 0) >= $2
        -- Never apply twice, whether the earlier application came from the
        -- tracker or from a previous auto-apply run.
        AND NOT EXISTS (
          SELECT 1 FROM job_applications ja
           WHERE ja.user_id = $1 AND ja.job_id = j.id
        )
        -- Never look at a posting twice, whatever happened last time.
        --
        -- This previously excluded only status='applied', so every job we had
        -- filled but not submitted, or failed to complete, came back the next
        -- night. Twenty-four attempts landed on eight distinct postings, three
        -- passes each: the same forms re-filled, the same questions re-asked,
        -- and nightly slots spent re-treading ground. A form that could not be
        -- completed yesterday will almost always fail again today, and with
        -- roughly 42k fresh Tier-1 postings a week there is no shortage of
        -- unseen ones to move on to.
        AND NOT EXISTS (
          SELECT 1 FROM apex_auto_apply_log l
           WHERE l.user_id = $1 AND l.job_id = j.id
        )
      ORDER BY ms.overall_score DESC NULLS LAST, j.first_detected_at DESC
      LIMIT $3`,
    [userId, filters.minMatchScore, Math.max(1, filters.limit) * 5],
  )

  const out: AutoApplyCandidate[] = []
  // The same posting reaches us under several job rows — the first live run
  // spent five of five nightly slots on three postings, applying twice to two
  // of them. Duplicate job rows are a known and unfinished cleanup, so dedupe
  // on the apply URL here rather than trusting the ids to be distinct: sending
  // an employer two identical applications is worse than sending one.
  const seenUrls = new Set<string>()
  for (const r of rows) {
    if (BLOCKED_ATS_HOSTS.test(r.apply_url)) continue
    const urlKey = r.apply_url.split("#")[0].replace(/\/+$/, "")
    if (seenUrls.has(urlKey)) continue
    if (classifyApplyMethod(r.apply_url, r.ats_type) !== "tier1_fillable") continue
    const ats = atsOf(r.apply_url)
    if (!filters.includeUnproven && !PROVEN_ATS.has(ats)) continue

    out.push({
      jobId: r.job_id,
      title: r.title,
      companyName: r.company_name,
      applyUrl: r.apply_url,
      ats,
      matchScore: r.match_score === null ? null : Number(r.match_score),
      firstDetectedAt: r.first_detected_at,
    })
    seenUrls.add(urlKey)
    if (out.length >= filters.limit) break
  }
  return out
}
