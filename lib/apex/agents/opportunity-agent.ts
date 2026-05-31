/**
 * OpportunityAgent
 *
 * Finds related job opportunities, adjacent companies, and skill unlocks
 * using the existing opportunity graph infrastructure.
 *
 * Runs when the user asks about related roles, career paths, or
 * sponsorship alternatives — enriches Claude with real relationship data.
 */

import type { ScoutAgent, ScoutExecutionContext, AgentResult } from "./types"
import type { OpportunityRecommendation } from "@/lib/scout/opportunity-graph/types"

type OpportunityResult = { recommendations: OpportunityRecommendation[] }

export class OpportunityAgent implements ScoutAgent<OpportunityResult> {
  readonly id = "opportunity"
  readonly relevantIntents = ["opportunity", "compare", "search"] as import("./types").AgentIntent[]

  async run(ctx: ScoutExecutionContext): Promise<AgentResult<OpportunityResult>> {
    const start = Date.now()

    const effectiveSkills = [
      ...(ctx.userSkills ?? []),
      ...(ctx.resume?.topSkills ?? []),
    ].filter((s, i, a) => s && a.indexOf(s) === i).slice(0, 20)

    if (effectiveSkills.length < 3 && !ctx.jobId) {
      return { agentId: this.id, success: true, durationMs: Date.now() - start }
    }

    try {
      // Run a lightweight version of the opportunity queries directly
      const skillsParam = effectiveSkills

      const [similarJobsRes, skillUnlockRes] = await Promise.all([
        skillsParam.length > 0
          ? ctx.pool.query<{ id: string; title: string; company_name: string; overlap_count: number; sponsors_h1b: boolean | null; is_remote: boolean; skills: string[] | null }>(
              `SELECT j.id, j.title, c.name AS company_name, j.sponsors_h1b, j.is_remote, j.skills,
                      (SELECT COUNT(*)
                       FROM UNNEST(j.skills) AS s
                       WHERE LOWER(s) = ANY(SELECT LOWER(e) FROM UNNEST($2::text[]) AS e)
                      )::int AS overlap_count
               FROM jobs j LEFT JOIN companies c ON c.id = j.company_id
               WHERE j.is_active = true
                 AND ($1::uuid IS NULL OR j.id != $1::uuid)
                 AND j.skills && $2::text[]
               ORDER BY overlap_count DESC, j.first_detected_at DESC LIMIT 5`,
              [ctx.jobId ?? null, skillsParam]
            )
          : Promise.resolve({ rows: [] }),

        skillsParam.length > 0
          ? ctx.pool.query<{ skill: string; job_count: number }>(
              `SELECT skill, COUNT(DISTINCT job_id) AS job_count
               FROM (
                 SELECT j.id AS job_id, j.skills, UNNEST(j.skills) AS skill
                 FROM jobs j WHERE j.is_active = true AND NOT (j.skills && $1::text[])
               ) sub
               WHERE LOWER(skill) != ALL(SELECT LOWER(s) FROM UNNEST($1::text[]) AS s)
               GROUP BY skill HAVING COUNT(DISTINCT job_id) >= 5
               ORDER BY job_count DESC LIMIT 5`,
              [skillsParam]
            )
          : Promise.resolve({ rows: [] }),
      ])

      const { skillOverlap, buildSimilarJobRecommendations, buildSkillUnlockRecommendations } =
        await import("@/lib/scout/opportunity-graph/generator")

      const similarHits = similarJobsRes.rows.filter((r) => r.overlap_count >= 2).map((r) => ({
        jobId:         r.id,
        title:         r.title,
        companyName:   r.company_name,
        companyId:     "",
        overlapCount:  r.overlap_count,
        overlapSkills: skillOverlap(skillsParam, r.skills ?? []),
        sponsorsH1b:   r.sponsors_h1b,
        isRemote:      r.is_remote,
        strength:      r.overlap_count / 10,
      }))

      const skillUnlockHits = skillUnlockRes.rows.map((r) => ({
        skill:      r.skill,
        jobCount:   Number(r.job_count),
        netUnlock:  Number(r.job_count),
        categories: [],
      }))

      const recs: OpportunityRecommendation[] = [
        ...buildSimilarJobRecommendations(similarHits, ctx.job?.title ?? "your target role"),
        ...buildSkillUnlockRecommendations(skillUnlockHits),
      ].slice(0, 4)

      if (!recs.length) return { agentId: this.id, success: true, durationMs: Date.now() - start }

      const lines = ["Opportunity Relationships (based on skill overlap — phrase cautiously):"]
      for (const r of recs) {
        lines.push(`  - ${r.title}${r.subtitle ? ` at ${r.subtitle}` : ""}: ${r.description}`)
      }

      return {
        agentId: this.id,
        success: true,
        data:    { recommendations: recs },
        contextSection: `\n${lines.join("\n")}`,
        durationMs: Date.now() - start,
      }
    } catch (err) {
      return {
        agentId:   this.id,
        success:   false,
        durationMs: Date.now() - start,
        error:     err instanceof Error ? err.message : "Opportunity agent failed",
      }
    }
  }
}
