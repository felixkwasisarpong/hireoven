/**
 * ResumeAgent
 *
 * Analyzes the user's resume against the active job description using the
 * existing compareResumeToJob() function. Surfaces gaps + match score into
 * Claude's context so tailor/workflow responses are grounded in real data.
 */

import type { ScoutAgent, ScoutExecutionContext, AgentResult } from "./types"

type ResumeResult = {
  missingKeywords: string[]
  presentKeywords: string[]
  matchScore:      number | null
  suggestedSummary?: string
}

export class ResumeAgent implements ScoutAgent<ResumeResult> {
  readonly id = "resume"
  readonly relevantIntents = ["tailor", "workflow"] as import("./types").AgentIntent[]

  async run(ctx: ScoutExecutionContext): Promise<AgentResult<ResumeResult>> {
    const start = Date.now()
    if (!ctx.resume?.id || !ctx.job?.description) {
      return { agentId: this.id, success: true, durationMs: Date.now() - start }
    }

    try {
      // Fetch full resume for compareResumeToJob
      const resumeRes = await ctx.pool.query<import("@/types").Resume>(
        `SELECT * FROM resumes WHERE id = $1 AND user_id = $2 LIMIT 1`,
        [ctx.resume.id, ctx.userId]
      )
      const resume = resumeRes.rows[0]
      if (!resume) return { agentId: this.id, success: true, durationMs: Date.now() - start }

      const { compareResumeToJob } = await import("@/lib/resume/hub")
      const analysis = compareResumeToJob(
        resume,
        ctx.job.description,
        ctx.job.title,
        ctx.job.companyName,
      )

      const missing  = analysis.missingKeywords?.slice(0, 8) ?? []
      const present  = analysis.presentKeywords?.slice(0, 6) ?? []
      const score    = analysis.matchScore ?? null

      const lines: string[] = [
        `Resume vs Job Analysis — ${ctx.job.title} at ${ctx.job.companyName}:`,
        `- Match score: ${score ?? "not computed"}%`,
      ]
      if (present.length) lines.push(`- Strong matches: ${present.join(", ")}`)
      if (missing.length) lines.push(`- Keyword gaps: ${missing.join(", ")}`)
      if (analysis.suggestedSummaryRewrite) lines.push(`- Summary rewrite suggestion available`)

      return {
        agentId: this.id,
        success: true,
        data: { missingKeywords: missing, presentKeywords: present, matchScore: score, suggestedSummary: analysis.suggestedSummaryRewrite ?? undefined },
        contextSection: `\n${lines.join("\n")}`,
        durationMs: Date.now() - start,
      }
    } catch (err) {
      return {
        agentId:   this.id,
        success:   false,
        durationMs: Date.now() - start,
        error:     err instanceof Error ? err.message : "Resume analysis failed",
      }
    }
  }
}
