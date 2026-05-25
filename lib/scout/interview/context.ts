import Anthropic from "@anthropic-ai/sdk"
import { getPostgresPool } from "@/lib/postgres/server"
import { HAIKU_MODEL } from "@/lib/ai/anthropic-models"
import type { InterviewPersona, InterviewQuestionSet } from "./queries"

export interface InterviewContext {
  resumeSummary: string
  resumeSkills: string[]
  resumeExperienceHighlights: string[]
  jobTitle: string
  companyName: string
  jdPriorities: string[]
  skillList: string[]
  recentFeedback: string[]
}

type WorkExperience = {
  title?: string
  company?: string
  description?: string
  achievements?: string[]
  start_date?: string
  end_date?: string | null
}

type ResumeRow = {
  id: string
  summary: string | null
  top_skills: string[] | null
  skills: { technical?: string[]; soft?: string[] } | null
  work_experience: WorkExperience[] | null
}

function deriveSkillList(
  questionSet: InterviewQuestionSet | string,
  jobTopSkills?: string[]
): string[] {
  switch (questionSet) {
    case "behavioral":
      return ["ownership", "conflict resolution", "ambiguity", "impact storytelling", "growth/feedback", "leadership/influence"]
    case "system_design":
      return ["scoping", "data modeling", "API design", "scaling", "tradeoffs", "reliability"]
    case "technical_screen":
      return jobTopSkills?.slice(0, 6).length
        ? jobTopSkills.slice(0, 6)
        : ["problem-solving", "coding proficiency", "system design", "collaboration", "code quality", "debugging"]
    case "coding":
      return ["problem decomposition", "code correctness", "edge cases", "optimization", "communication", "test coverage"]
    case "mixed":
      return ["ownership", "impact storytelling", "ambiguity", "problem-solving", "system thinking", "collaboration"]
    default:
      return []
  }
}

export { deriveSkillList }

export async function buildInterviewContext(input: {
  userId: string
  jobId?: string | null
  useResume: boolean
  questionSet: InterviewQuestionSet | string
}): Promise<InterviewContext> {
  const pool = getPostgresPool()
  const anthropic = process.env.ANTHROPIC_API_KEY
    ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    : null

  // ── Resume ─────────────────────────────────────────────────────────────────
  let resumeSummary = ""
  let resumeSkills: string[] = []
  let resumeExperienceHighlights: string[] = []

  if (input.useResume) {
    const resumeResult = await pool.query<ResumeRow>(
      `SELECT id, summary, top_skills, skills, work_experience
       FROM resumes
       WHERE user_id = $1 AND parse_status = 'parsed'
       ORDER BY is_primary DESC, updated_at DESC
       LIMIT 1`,
      [input.userId]
    )

    const resume = resumeResult.rows[0]
    if (resume) {
      // Skills
      const technical = resume.skills?.technical ?? []
      const soft = resume.skills?.soft ?? []
      const topSkills = resume.top_skills ?? []
      resumeSkills = [...new Set([...topSkills, ...technical])].slice(0, 12)

      // Experience highlights — top 5 achievements from most recent roles
      const experiences = (resume.work_experience ?? []).slice(0, 3)
      for (const exp of experiences) {
        const bullets = exp.achievements?.filter(Boolean) ?? []
        if (bullets.length > 0) {
          resumeExperienceHighlights.push(...bullets.slice(0, 2))
        } else if (exp.description) {
          resumeExperienceHighlights.push(
            `${exp.title ?? "Role"} at ${exp.company ?? "Company"}: ${exp.description.slice(0, 120)}`
          )
        }
        if (resumeExperienceHighlights.length >= 5) break
      }
      resumeExperienceHighlights = resumeExperienceHighlights.slice(0, 5)

      // Summary — use existing or construct one
      if (resume.summary) {
        const words = resume.summary.split(/\s+/)
        resumeSummary = words.slice(0, 200).join(" ")
      } else if (anthropic && experiences.length > 0) {
        const workText = experiences
          .map((e) => `${e.title ?? ""} at ${e.company ?? ""}: ${(e.achievements ?? []).slice(0, 2).join("; ")}`)
          .join("\n")

        try {
          const res = await anthropic.messages.create({
            model: HAIKU_MODEL,
            max_tokens: 250,
            messages: [{
              role: "user",
              content: `Write a 2-3 sentence professional summary for a job candidate based on their experience. Be concise and factual. No fluff.\n\n${workText}`,
            }],
          })
          const generated = (res.content[0] as { type: string; text: string }).text.trim()
          resumeSummary = generated
          // Cache it
          await pool.query("UPDATE resumes SET summary = $1 WHERE id = $2", [generated, resume.id])
        } catch {
          resumeSummary = `${resumeSkills.slice(0, 5).join(", ")} professional.`
        }
      } else {
        resumeSummary = resumeSkills.slice(0, 5).join(", ") + " professional."
      }
    }
  }

  // ── Job context ────────────────────────────────────────────────────────────
  let jobTitle = "the role"
  let companyName = "the company"
  let jdPriorities: string[] = []
  let jobTopSkills: string[] = []

  if (input.jobId) {
    const jobResult = await pool.query<{
      title: string
      description: string | null
      company_name: string | null
      skills: string[] | null
    }>(
      `SELECT j.title, j.description, c.name AS company_name, j.skills
       FROM jobs j
       LEFT JOIN companies c ON c.id = j.company_id
       WHERE j.id = $1`,
      [input.jobId]
    )
    const job = jobResult.rows[0]
    if (job) {
      jobTitle = job.title
      companyName = job.company_name ?? "the company"
      jobTopSkills = (job.skills ?? []).filter((s): s is string => typeof s === "string")

      if (job.description && anthropic) {
        try {
          const res = await anthropic.messages.create({
            model: HAIKU_MODEL,
            max_tokens: 200,
            messages: [{
              role: "user",
              content: `Extract 4-6 short priority phrases from this job description. One line each. No numbering, bullets, or extra text. Output only the phrases.\n\n${job.description.slice(0, 3000)}`,
            }],
          })
          jdPriorities = (res.content[0] as { type: string; text: string }).text
            .trim()
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean)
            .slice(0, 6)
        } catch {
          // Fall through with empty jdPriorities
        }
      }
    }
  }

  // ── Recent feedback gaps ───────────────────────────────────────────────────
  const debriefResult = await pool.query<{ gaps: unknown[] }>(
    `SELECT d.gaps
     FROM interview_debriefs d
     JOIN interview_sessions s ON s.id = d.session_id
     WHERE s.user_id = $1 AND s.status = 'completed'
     ORDER BY d.generated_at DESC
     LIMIT 3`,
    [input.userId]
  )

  const recentFeedback: string[] = []
  for (const row of debriefResult.rows) {
    if (!Array.isArray(row.gaps)) continue
    for (const gap of row.gaps) {
      if (typeof gap === "string") recentFeedback.push(gap)
      else if (typeof gap === "object" && gap !== null) {
        const obs = (gap as Record<string, unknown>).observation
        if (typeof obs === "string") recentFeedback.push(obs)
      }
    }
  }

  const uniqueFeedback = [...new Set(recentFeedback)].slice(0, 5)

  const skillList = deriveSkillList(input.questionSet, jobTopSkills)

  return {
    resumeSummary,
    resumeSkills,
    resumeExperienceHighlights,
    jobTitle,
    companyName,
    jdPriorities,
    skillList,
    recentFeedback: uniqueFeedback,
  }
}
