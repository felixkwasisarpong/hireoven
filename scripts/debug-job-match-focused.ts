/**
 * Focused match analysis: scores a candidate against a job along three
 * explicit axes — experience level, technical skills, industry fit —
 * and returns a single overall score with reasoning per axis. Uses the
 * same Claude model as the production analyzer but a custom prompt.
 *
 *   npx tsx scripts/debug-job-match-focused.ts <jobId> [userEmail]
 */

import { loadEnvConfig } from "@next/env"
loadEnvConfig(process.cwd())

import Anthropic from "@anthropic-ai/sdk"
import { getPostgresPool } from "@/lib/postgres/server"
import { SONNET_MODEL } from "@/lib/ai/anthropic-models"
import type { Company, Job, Resume } from "@/types"

const PROMPT_TEMPLATE = (resume: Resume, job: Job & { company: Company }) => {
  const work = (resume.work_experience ?? [])
    .map(
      (w) =>
        `- ${w.title} @ ${w.company} (${w.start_date} → ${w.end_date ?? "Present"})\n  ${(w.description ?? "").slice(0, 350)}`
    )
    .join("\n")

  return `You are scoring a candidate's fit for a job along three explicit axes:
  1. EXPERIENCE LEVEL — does years-of-experience and seniority match what the role needs? Over-qualified, under-qualified, or right-fit?
  2. SKILLS — direct overlap between the candidate's tech stack and the job's required skills.
  3. INDUSTRY EXPERIENCE — does the candidate's industry background (sectors, domain problems solved) transfer to this company's industry?

Return ONLY a valid JSON object with this exact shape:

{
  "overall_score": <0-100>,
  "verdict": "<one of: strong_match | good_match | moderate_match | weak_match>",
  "experience_level": {
    "score": <0-100>,
    "candidate_years": <number>,
    "required_years_est": <number>,
    "seniority_fit": "<under | right_fit | over>",
    "reasoning": "<one or two sentences>"
  },
  "skills": {
    "score": <0-100>,
    "matched": [<top 10 matching skills>],
    "missing": [<top 10 missing required/preferred skills>],
    "reasoning": "<one or two sentences>"
  },
  "industry_experience": {
    "score": <0-100>,
    "candidate_industries": [<list>],
    "target_industry": "<job's industry>",
    "transfer_quality": "<direct | adjacent | distant>",
    "reasoning": "<one or two sentences on how well the domain transfers>"
  },
  "bottom_line": "<3-4 sentence honest take on whether to apply>"
}

JOB:
Title: ${job.title}
Company: ${job.company.name}
Industry: ${job.company.industry ?? "Not specified"}
Seniority: ${job.seniority_level ?? "Not specified"}
Required skills: ${(job.skills ?? []).join(", ") || "Not specified"}
Description:
${(job.description ?? "").slice(0, 5000)}

CANDIDATE:
Name: ${resume.full_name ?? "—"}
Years experience (claimed): ${resume.years_of_experience ?? "?"}
Primary role: ${resume.primary_role ?? "—"}
Seniority self-assessed: ${resume.seniority_level ?? "—"}
Top skills: ${(resume.top_skills ?? []).join(", ") || (resume.skills ?? []).slice(0, 25).join(", ")}
Industries: ${(resume.industries ?? []).join(", ") || "—"}
Resume summary: ${(resume.summary ?? "").slice(0, 600)}

Work history:
${work}
`
}

function extractJson(text: string): string {
  // Claude sometimes wraps JSON in ```json fences or includes preamble.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced) return fenced[1].trim()
  const firstBrace = text.indexOf("{")
  const lastBrace = text.lastIndexOf("}")
  if (firstBrace >= 0 && lastBrace > firstBrace) return text.slice(firstBrace, lastBrace + 1)
  return text
}

async function main() {
  const jobId = process.argv[2]
  const email = process.argv[3] ?? "felixsarpong25@gmail.com"
  if (!jobId) {
    console.error("usage: npx tsx scripts/debug-job-match-focused.ts <jobId> [userEmail]")
    process.exit(2)
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set")
  const anthropic = new Anthropic({ apiKey })

  const pool = getPostgresPool()
  try {
    const u = await pool.query<{ id: string }>(`SELECT id FROM auth.users WHERE email=$1`, [email])
    if (!u.rows[0]) throw new Error(`user not found: ${email}`)
    const userId = u.rows[0].id

    const r = await pool.query<Resume>(
      `SELECT * FROM resumes WHERE user_id=$1 AND parse_status='parsed' AND archived_at IS NULL
       ORDER BY is_primary DESC, created_at DESC LIMIT 1`,
      [userId]
    )
    const resume = r.rows[0]
    if (!resume) throw new Error("no parsed primary resume")

    const j = await pool.query<Job & { company: Company }>(
      `SELECT jobs.*, to_jsonb(companies.*) AS company
       FROM jobs LEFT JOIN companies ON companies.id = jobs.company_id
       WHERE jobs.id=$1`,
      [jobId]
    )
    const job = j.rows[0]
    if (!job) throw new Error(`job not found: ${jobId}`)

    console.log(`Job:     ${job.title} @ ${job.company.name} | industry=${job.company.industry ?? "—"} | seniority=${job.seniority_level ?? "—"}`)
    console.log(`Resume:  ${resume.full_name ?? resume.name} | ${resume.years_of_experience}y | role=${resume.primary_role ?? "—"} | industries=${(resume.industries ?? []).join(", ") || "—"}`)
    console.log(`Model:   ${SONNET_MODEL}\n`)
    console.log(`Calling Claude...\n`)

    const t0 = Date.now()
    const msg = await anthropic.messages.create({
      model: SONNET_MODEL,
      max_tokens: 2_000,
      messages: [{ role: "user", content: PROMPT_TEMPLATE(resume, job) }],
    })
    const text = msg.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { text: string }).text)
      .join("\n")
    const parsed = JSON.parse(extractJson(text))
    const ms = Date.now() - t0

    console.log(`════════════════════════════════════════════════════════════════════`)
    console.log(`OVERALL:  ${parsed.overall_score}/100   verdict=${parsed.verdict}`)
    console.log(`════════════════════════════════════════════════════════════════════\n`)

    const axis = (label: string, key: string, extra?: () => string) => {
      const a = parsed[key] as { score: number; reasoning?: string }
      console.log(`▸ ${label}:  ${a.score}/100`)
      if (extra) console.log(extra())
      if (a.reasoning) console.log(`  ${a.reasoning}\n`)
    }
    axis("EXPERIENCE LEVEL", "experience_level", () => {
      const x = parsed.experience_level
      return `  ${x.candidate_years}y candidate vs ~${x.required_years_est}y required → ${x.seniority_fit}`
    })
    axis("SKILLS         ", "skills", () => {
      const x = parsed.skills
      const matched = (x.matched ?? []).slice(0, 12).join(", ")
      const missing = (x.missing ?? []).slice(0, 10).join(", ")
      return `  matched: ${matched}\n  missing: ${missing}`
    })
    axis("INDUSTRY FIT   ", "industry_experience", () => {
      const x = parsed.industry_experience
      return `  ${(x.candidate_industries ?? []).join(", ")} → ${x.target_industry} (${x.transfer_quality})`
    })

    if (parsed.bottom_line) {
      console.log(`════════════════════════════════════════════════════════════════════`)
      console.log(`BOTTOM LINE:\n${parsed.bottom_line}\n`)
    }
    console.log(`(${ms}ms; in=${msg.usage.input_tokens} out=${msg.usage.output_tokens} tokens)`)
  } finally {
    await pool.end()
  }
}

main().catch((err) => { console.error(err); process.exit(1) })
