import Anthropic from "@anthropic-ai/sdk"
import { logApiUsage } from "@/lib/admin/usage"
import { createAdminClient } from "@/lib/supabase/admin"
import type {
  CoverLetter,
  CoverLetterInsert,
  CoverLetterOptions,
  Company,
  Job,
  Resume,
} from "@/types"

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null

const MODEL = "claude-sonnet-4-6"
const MODEL_PRICING = { inputPerMillion: 3, outputPerMillion: 15 }

const TONE_GUIDE = {
  professional:
    "Professional and polished. Confident without being arrogant. Clear and direct.",
  conversational:
    "Warm and natural, like a smart colleague writing to another. Still professional but human and approachable.",
  enthusiastic:
    "Genuine excitement about the role and company. Energy comes through without being over the top or using clichés.",
  formal:
    "Traditional business letter format. Conservative and respectful. Appropriate for finance, law, or government roles.",
}

const STYLE_GUIDE = {
  story:
    "Open with a brief compelling story or moment that connects your background to this role. Lead with narrative.",
  skills_focused:
    "Lead with your most relevant skills for this specific role. Evidence-based, direct match of your skills to their needs.",
  achievement_focused:
    "Lead with your strongest relevant achievement. Let results speak first, then connect to the role.",
}

const LENGTH_GUIDE = {
  short: "150-200 words. Tight and punchy. 3 paragraphs maximum.",
  medium: "250-350 words. Balanced. 3-4 paragraphs.",
  long: "400-500 words. Thorough. 4-5 paragraphs. Good for senior roles or when you have a lot of relevant experience.",
}

function buildSystemPrompt(options: CoverLetterOptions): string {
  return `You are an expert cover letter writer who has helped thousands of candidates land jobs at top companies. You write cover letters that sound like the real person wrote them - not like AI.

Your cover letters:
- Never start with "I am writing to apply for"
- Never use: passionate, synergy, leverage, dynamic, results-driven, team player, hard worker, go-getter
- Always reference specific things about the company or role (not generic praise)
- Show genuine understanding of what the role involves
- Connect the candidate's SPECIFIC experience to the role's SPECIFIC needs
- Sound like a real human wrote it in their natural voice

Tone: ${TONE_GUIDE[options.tone]}
Style: ${STYLE_GUIDE[options.style]}
Length: ${LENGTH_GUIDE[options.length]}`
}

function buildUserPrompt(
  resume: Resume,
  job: Job & { company: Company },
  options: CoverLetterOptions
): string {
  const workExperience = (resume.work_experience ?? [])
    .slice(0, 3)
    .map(
      (w) =>
        `${w.title} at ${w.company}:\n${w.achievements.slice(0, 3).join(" | ")}`
    )
    .join("\n\n")

  const matchingSkills = options.analysis?.matching_skills?.slice(0, 5).join(", ") ?? ""
  const missingSkills = options.analysis?.missing_skills?.slice(0, 3).join(", ") ?? ""

  return `Write a cover letter for this candidate applying to this job.

CANDIDATE:
Name: ${resume.full_name ?? "The candidate"}
Current/Recent role: ${resume.primary_role ?? "Not specified"}
Years experience: ${resume.years_of_experience ?? "Not specified"}
Top skills: ${(resume.top_skills ?? []).slice(0, 8).join(", ")}

Most relevant experience for this role:
${workExperience || "Not available"}

${resume.summary ? `Their current summary:\n${resume.summary}` : ""}

${matchingSkills ? `Matching skills to highlight: ${matchingSkills}` : ""}

${missingSkills ? `Note: candidate is missing these required skills: ${missingSkills}. Do not mention these gaps - focus on strengths.` : ""}

JOB:
Title: ${job.title}
Company: ${job.company.name}
Industry: ${job.company.industry ?? "Not specified"}
Seniority: ${job.seniority_level ?? "Not specified"}
Location: ${job.location ?? "Not specified"}
${job.is_remote ? "This is a remote role." : ""}

Key requirements from job description:
${(job.description ?? "").slice(0, 2000)}

${options.hiringManager ? `Address to: ${options.hiringManager}` : 'Use "Dear Hiring Manager" if no name known'}

${
  options.mentionSponsorship && options.sponsorshipApproach === "proactive"
    ? `IMPORTANT: This candidate requires H1B visa sponsorship. Address this proactively and positively - mention it briefly and confidently, framing it as a non-issue. Something like 'I will require visa sponsorship, which I understand you support.' Keep it one sentence, matter-of-fact.`
    : ""
}

${options.customInstructions ? `Additional instructions from candidate:\n${options.customInstructions}` : ""}

Return ONLY a JSON object:
{
  "subject_line": "email subject if sending by email",
  "body": "the full cover letter text",
  "word_count": number,
  "opening_line": "just the first sentence, for quick preview"
}`
}

function extractJsonObject(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
  const candidate = (fenced ?? text).trim()
  const objectMatch = candidate.match(/\{[\s\S]*\}/)
  if (!objectMatch) throw new Error("No JSON object found in Claude response")
  return objectMatch[0].replace(/,\s*([}\]])/g, "$1")
}

async function callClaudeForLetter(
  systemPrompt: string,
  userPrompt: string
): Promise<{ subject_line: string; body: string; word_count: number; opening_line: string }> {
  if (!anthropic) throw new Error("ANTHROPIC_API_KEY not configured")

  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  })

  const inputTokens = message.usage?.input_tokens ?? 0
  const outputTokens = message.usage?.output_tokens ?? 0
  const costUsd =
    (inputTokens / 1_000_000) * MODEL_PRICING.inputPerMillion +
    (outputTokens / 1_000_000) * MODEL_PRICING.outputPerMillion

  await logApiUsage({
    service: "claude",
    operation: "cover_letter_generate",
    tokens_used: inputTokens + outputTokens,
    cost_usd: Number(costUsd.toFixed(6)),
  })

  const text = message.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")

  const parsed = JSON.parse(extractJsonObject(text)) as {
    subject_line?: unknown
    body?: unknown
    word_count?: unknown
    opening_line?: unknown
  }

  return {
    subject_line: typeof parsed.subject_line === "string" ? parsed.subject_line : "",
    body: typeof parsed.body === "string" ? parsed.body : "",
    word_count: typeof parsed.word_count === "number" ? parsed.word_count : 0,
    opening_line: typeof parsed.opening_line === "string" ? parsed.opening_line : "",
  }
}

export async function generateCoverLetter(
  resume: Resume,
  job: Job & { company: Company },
  options: CoverLetterOptions,
  userId: string
): Promise<CoverLetter> {
  const systemPrompt = buildSystemPrompt(options)
  const userPrompt = buildUserPrompt(resume, job, options)
  const generated = await callClaudeForLetter(systemPrompt, userPrompt)

  const supabase = createAdminClient()

  const { count } = await (supabase
    .from("cover_letters")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("job_id", job.id) as any)

  const payload: CoverLetterInsert = {
    user_id: userId,
    resume_id: resume.id,
    job_id: job.id,
    job_title: job.title,
    company_name: job.company.name,
    hiring_manager: options.hiringManager ?? null,
    subject_line: generated.subject_line,
    body: generated.body,
    word_count: generated.word_count,
    tone: options.tone,
    length: options.length,
    style: options.style,
    version_number: ((count as number | null) ?? 0) + 1,
    is_favorite: false,
    was_used: false,
    mentions_sponsorship: Boolean(options.mentionSponsorship),
    sponsorship_approach: options.sponsorshipApproach ?? null,
  }

  const { data, error } = await (supabase
    .from("cover_letters")
    .insert(payload as any)
    .select("*")
    .single() as any)

  if (error || !data) throw error ?? new Error("Failed to save cover letter")
  return data as CoverLetter
}

export async function regenerateParagraph(
  coverLetterId: string,
  paragraphIndex: number,
  instruction: string,
  userId: string
): Promise<string> {
  if (!anthropic) throw new Error("ANTHROPIC_API_KEY not configured")

  const supabase = createAdminClient()
  const { data } = await (supabase
    .from("cover_letters")
    .select("body, job_title, company_name, tone")
    .eq("id", coverLetterId)
    .eq("user_id", userId)
    .single() as any)

  if (!data) throw new Error("Cover letter not found")

  const cl = data as { body: string; job_title: string; company_name: string; tone: string }
  const paragraphs = cl.body.split("\n\n")
  const target = paragraphs[paragraphIndex]
  if (!target) throw new Error("Paragraph not found")

  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 512,
    system:
      "You are an expert cover letter editor. Rewrite the given paragraph according to the instruction. Maintain the overall tone and context. Return ONLY the rewritten paragraph - no explanation, no quotes, just the paragraph.",
    messages: [
      {
        role: "user",
        content: `Cover letter: ${cl.job_title} at ${cl.company_name} (tone: ${cl.tone})

Original paragraph:
${target}

Instruction: ${instruction}`,
      },
    ],
  })

  const inputTokens = message.usage?.input_tokens ?? 0
  const outputTokens = message.usage?.output_tokens ?? 0
  const costUsd =
    (inputTokens / 1_000_000) * MODEL_PRICING.inputPerMillion +
    (outputTokens / 1_000_000) * MODEL_PRICING.outputPerMillion

  await logApiUsage({
    service: "claude",
    operation: "cover_letter_paragraph",
    tokens_used: inputTokens + outputTokens,
    cost_usd: Number(costUsd.toFixed(6)),
  })

  const newParagraph = message.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim()

  paragraphs[paragraphIndex] = newParagraph
  const newBody = paragraphs.join("\n\n")
  const wordCount = newBody.split(/\s+/).filter(Boolean).length

  await (supabase
    .from("cover_letters")
    .update({ body: newBody, word_count: wordCount, updated_at: new Date().toISOString() })
    .eq("id", coverLetterId)
    .eq("user_id", userId) as any)

  return newBody
}

export async function generateVariants(
  resume: Resume,
  job: Job & { company: Company },
  options: CoverLetterOptions,
  userId: string,
  count = 3
): Promise<CoverLetter[]> {
  const VARIANT_OVERRIDES: Array<Partial<CoverLetterOptions>> = [
    { tone: "professional", style: "story" },
    { tone: "conversational", style: "achievement_focused" },
    { tone: "enthusiastic", style: "skills_focused" },
  ]

  const configs = VARIANT_OVERRIDES.slice(0, count).map((v) => ({ ...options, ...v }))
  return Promise.all(configs.map((config) => generateCoverLetter(resume, job, config, userId)))
}
