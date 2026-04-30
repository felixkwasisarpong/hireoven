/**
 * CompanyIntelAgent
 *
 * Derives company intelligence (hiring velocity, sponsorship signals, response
 * likelihood) from the company already in context — no extra DB round-trips.
 *
 * The /api/scout/company-intel/[id] endpoint exists for the UI rail, but that
 * route isn't called in chat requests. This agent bridges the gap.
 */

import type { ScoutAgent, ScoutExecutionContext, AgentResult } from "./types"
import type { CompanyIntelSummary } from "@/lib/scout/company-intel/types"

type CompanyIntelResult = { summary: CompanyIntelSummary }

export class CompanyIntelAgent implements ScoutAgent<CompanyIntelResult> {
  readonly id = "company"
  readonly relevantIntents = ["compare", "tailor", "company", "workflow"] as import("./types").AgentIntent[]

  async run(ctx: ScoutExecutionContext): Promise<AgentResult<CompanyIntelResult>> {
    const start = Date.now()
    if (!ctx.company?.id) {
      return { agentId: this.id, success: true, durationMs: Date.now() - start }
    }

    try {
      const [companyRes, jobsRes] = await Promise.all([
        ctx.pool.query<import("@/types").Company>(
          `SELECT * FROM companies WHERE id = $1 LIMIT 1`,
          [ctx.company.id]
        ),
        ctx.pool.query<{ id: string; title: string; first_detected_at: string; last_seen_at: string; is_active: boolean; is_remote: boolean; sponsors_h1b: boolean | null; sponsorship_score: number; skills: string[] | null; normalized_title: string | null }>(
          `SELECT id, title, first_detected_at, last_seen_at, is_active, is_remote,
                  sponsors_h1b, sponsorship_score, skills, normalized_title
           FROM jobs WHERE company_id = $1 AND is_active = true ORDER BY first_detected_at DESC LIMIT 50`,
          [ctx.company.id]
        ),
      ])

      const company = companyRes.rows[0]
      const jobs    = jobsRes.rows
      if (!company) return { agentId: this.id, success: true, durationMs: Date.now() - start }

      const { deriveCompanyIntel, buildCompanyIntelSummary, formatCompanyIntelForClaude } =
        await import("@/lib/scout/company-intel/aggregator")

      const intel   = deriveCompanyIntel(company as import("@/types").Company, jobs as import("@/types").Job[])
      const summary = buildCompanyIntelSummary(company as import("@/types").Company, intel, jobs.length)
      const formatted = formatCompanyIntelForClaude(summary)

      return {
        agentId: this.id,
        success: true,
        data:    { summary },
        contextSection: formatted
          ? `\nCompany Intelligence — ${ctx.company.name}:\n${formatted}`
          : undefined,
        durationMs: Date.now() - start,
      }
    } catch (err) {
      return {
        agentId:   this.id,
        success:   false,
        durationMs: Date.now() - start,
        error:     err instanceof Error ? err.message : "Company intel failed",
      }
    }
  }
}
