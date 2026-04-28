/**
 * ATS-aware resume tailoring.
 *
 * Different applicant tracking systems parse resumes differently. This module
 * provides ATS-specific profiles that drive smarter suggestions and summary
 * rewrites — so the output beats both the ATS parser AND lands sharp with the
 * human recruiter who sees it next.
 *
 * Supported ATS: Workday · Greenhouse · Lever · Ashby · iCIMS · SmartRecruiters
 *                BambooHR · Generic
 */

import Anthropic from "@anthropic-ai/sdk"
import type { Resume } from "@/types"
import type { TailorAnalysisResult } from "@/types/tailor-analysis"
import { buildLocalTailorAnalysis } from "@/lib/resume/tailor-analysis"
import { normalizeKeyword } from "@/lib/resume/hub"

export type KnownATS =
  | "workday"
  | "greenhouse"
  | "lever"
  | "ashby"
  | "icims"
  | "smartrecruiters"
  | "bamboohr"
  | "generic"

// ── ATS profiles ──────────────────────────────────────────────────────────────

export interface AtsProfile {
  name: string
  /**
   * How strict the keyword matching is.
   * - exact: only verbatim matches score; synonyms are ignored
   * - balanced: verbatim preferred, related terms partially credited
   * - semantic: NLP-based; related terms understood
   */
  keywordStrategy: "exact" | "balanced" | "semantic"
  /** How to write / rewrite the resume summary for this ATS */
  summaryInstruction: string
  /** How to handle the skills section */
  skillsInstruction: string
  /** How to phrase experience bullets */
  bulletInstruction: string
  /** Human-readable note shown in the popup preview */
  recruiterNote: string
  /** Technical parser quirks */
  parserNotes: string
}

export const ATS_PROFILES: Record<KnownATS, AtsProfile> = {
  workday: {
    name: "Workday",
    keywordStrategy: "exact",
    summaryInstruction:
      "Start sentence 1 with your current/target job title matching the posting title exactly. " +
      "Sentence 2 must contain at least 3 exact skill keywords from the JD. " +
      "Sentence 3 can add context. Max 3 sentences. " +
      "Workday parses the opening title and first 100 chars of the summary most heavily.",
    skillsInstruction:
      "List skills exactly as written in the JD — no paraphrasing. " +
      "Include both the full form and the abbreviation for every term where both exist " +
      "(e.g. 'Kubernetes (K8s)', 'Machine Learning (ML)'). " +
      "Group into: Technical Skills · Tools & Platforms · Methodologies. " +
      "Workday scores each field individually — a separate Skills section outweighs keywords scattered in bullets.",
    bulletInstruction:
      "Every bullet: strong past-tense verb → scope/system → measurable outcome (%, $, scale, time). " +
      "Embed at least one exact JD keyword in the first two bullets of each role. " +
      "Date format for roles must be MM/YYYY. Avoid tables, columns, graphics.",
    recruiterNote:
      "Workday matches keywords exactly — exact phrasing from the JD matters more than synonyms.",
    parserNotes:
      "Strict date parsing (MM/YYYY). No tables, columns, text boxes, or headers/footers. " +
      "Avoid special Unicode bullets — use plain hyphens or ASCII bullets.",
  },

  greenhouse: {
    name: "Greenhouse",
    keywordStrategy: "semantic",
    summaryInstruction:
      "Lead with a tight 1-sentence value proposition: your title + strongest differentiator relevant to this role. " +
      "Mention 2-3 top skills explicitly. " +
      "Greenhouse recruiters read summaries; make it human-sounding and specific to this company.",
    skillsInstruction:
      "Clean skills list — one skill per line or comma-separated is fine. " +
      "Include both the canonical name and common abbreviations " +
      "(e.g. 'Kubernetes / K8s'). " +
      "Greenhouse parses the skills section separately and surfaces it on the recruiter card.",
    bulletInstruction:
      "Greenhouse recruiters skim the FIRST bullet per role — make it your strongest. " +
      "Pattern: strong verb + what you owned + quantified outcome. " +
      "Semantic matching works, but still name the exact tools from the JD.",
    recruiterNote:
      "Greenhouse shows a candidate card to recruiters. Your summary and first bullet per role are the preview.",
    parserNotes:
      "Excellent PDF/HTML parser. Semantic matching handles synonyms but exact matches still score higher.",
  },

  lever: {
    name: "Lever",
    keywordStrategy: "semantic",
    summaryInstruction:
      "Lever shows your summary prominently on the candidate card. " +
      "First sentence = elevator pitch: who you are + what you build + one differentiator. " +
      "Keep it under 2 sentences. Lever recruiters compare candidates side-by-side — " +
      "make the summary scannable and distinct.",
    skillsInstruction:
      "Keep the skills section clean and scannable — 5–10 skills per category max. " +
      "Lever surfaces skills on the candidate card, so they heavily influence first impressions. " +
      "Mirror the exact language from the JD where possible.",
    bulletInstruction:
      "Lever recruiters compare candidates side by side — metrics stand out instantly. " +
      "Every bullet should answer: what did you build/own/improve + how big was the impact? " +
      "Include the tool or system name from the JD.",
    recruiterNote:
      "Lever candidate cards show your summary and top skills prominently — these are read before your experience.",
    parserNotes: "Strong parser. Semantic equivalents are understood. Still include exact JD terms.",
  },

  ashby: {
    name: "Ashby",
    keywordStrategy: "semantic",
    summaryInstruction:
      "Ashby is used by high-growth startups — directness and specificity win. " +
      "First sentence: what you build + the tech stack + the scale or impact. " +
      "No hollow phrases ('passionate', 'results-driven'). " +
      "Make the recruiter feel they understand your work in one sentence.",
    skillsInstruction:
      "Use structured skill categories. Include domain context for each tool " +
      "(e.g. 'PostgreSQL (databases)', 'React (frontend)'). " +
      "Ashby's modern parser understands semantic equivalents, but explicit categories help.",
    bulletInstruction:
      "Startup formula: 'Built/redesigned/scaled X with Y, achieving Z (metric).' " +
      "Tech stack + scope + outcome in every bullet. " +
      "Ashby recruiters are often technical — specificity over buzzwords.",
    recruiterNote:
      "Ashby is used mostly by startups/scale-ups. Concrete engineering specificity wins over generic management language.",
    parserNotes: "Best-in-class parser. Semantic matching is strong. Still benefit from exact JD keywords.",
  },

  icims: {
    name: "iCIMS",
    keywordStrategy: "exact",
    summaryInstruction:
      "CRITICAL — iCIMS uses hard string matching. " +
      "Your summary MUST contain the exact job title string and at least 4 exact skill phrases from the JD. " +
      "Do not paraphrase. If the JD says 'microservices architecture', your summary must say 'microservices architecture' — not 'distributed systems' or 'service-oriented design'.",
    skillsInstruction:
      "CRITICAL — list every required skill from the JD exactly as written. " +
      "iCIMS scores based on exact string matches — 'ML' will NOT match 'Machine Learning'; list both. " +
      "'REST API' will NOT match 'RESTful APIs' — list both variants. " +
      "More is better here; duplicate entries won't hurt.",
    bulletInstruction:
      "Copy exact phrases from the JD into bullets. " +
      "If the JD says 'CI/CD pipelines', a bullet must say 'CI/CD pipelines'. " +
      "Every bullet: action verb + exact JD tool/phrase + measurable result.",
    recruiterNote:
      "iCIMS scores purely on exact keyword density. Missing one required phrase can disqualify the resume before a human sees it.",
    parserNotes:
      "Older, strict parser. Absolutely no tables, columns, or special formatting. " +
      "Use plain hyphens for bullets. Dates must be in MM/YYYY format. " +
      "Avoid headers and footers — content inside them is often ignored.",
  },

  smartrecruiters: {
    name: "SmartRecruiters",
    keywordStrategy: "balanced",
    summaryInstruction:
      "SmartRecruiters weights job title match very heavily. " +
      "Your current/target title in the summary should mirror the JD title exactly. " +
      "Include 4–5 core skill keywords from the JD in the first 2 sentences.",
    skillsInstruction:
      "SmartRecruiters has an internal skills taxonomy. " +
      "Align your listed skills to standard industry names — they get scored against the taxonomy. " +
      "A structured skills section clearly outperforms keywords scattered in bullets.",
    bulletInstruction:
      "SmartRecruiters shows bullet structure clearly to recruiters in their UI. " +
      "Strong verb + scope + outcome per bullet. " +
      "Include 1–2 exact JD skill names per bullet in the most recent role.",
    recruiterNote:
      "SmartRecruiters scores job title similarity and skills section heavily — make your current title match the target role.",
    parserNotes: "Good modern parser. Partial semantic matching. Current role and title are weighted highest.",
  },

  bamboohr: {
    name: "BambooHR",
    keywordStrategy: "balanced",
    summaryInstruction:
      "BambooHR is used by SMBs and the hiring manager typically reads personally. " +
      "Be direct and human — lead with what you do + a concrete result. " +
      "Avoid corporate jargon. 2–3 sentences max.",
    skillsInstruction:
      "Honest, readable skills list. BambooHR hiring managers often review it personally. " +
      "List only skills you'd be comfortable being quizzed on in an interview.",
    bulletInstruction:
      "Readable and clear over keyword-stuffed. " +
      "SMB hiring managers may not be technical specialists — explain impact in plain English. " +
      "Pattern: verb + what you did + why it mattered to the business.",
    recruiterNote:
      "BambooHR is typically used by smaller companies — the person who set up the ATS often reviews resumes personally.",
    parserNotes: "Decent PDF parser. Simple layout preferred. Human readability matters more than ATS tricks.",
  },

  generic: {
    name: "Generic ATS",
    keywordStrategy: "balanced",
    summaryInstruction:
      "Include your target role title and 3–4 exact skill keywords from the JD in the first 2 sentences. " +
      "Max 3 sentences. Lead with your strongest claim relevant to this role.",
    skillsInstruction:
      "Dedicated skills section with exact JD terms. " +
      "Include both abbreviations and full forms for every tool. " +
      "Group by category if you have 10+ skills.",
    bulletInstruction:
      "Action verb + what you owned + measurable result. " +
      "Include relevant tools from the JD. At least one metric per role.",
    recruiterNote:
      "Unknown ATS — applying safe best practices: exact keyword matching, clean formatting, strong metrics.",
    parserNotes:
      "Safe defaults: no tables, simple formatting, standard section headers, plain text bullets.",
  },
}

export function getAtsProfile(ats: string | null | undefined): AtsProfile {
  const key = (ats ?? "generic").toLowerCase() as KnownATS
  return ATS_PROFILES[key] ?? ATS_PROFILES.generic
}

// ── Resume → buildLocalTailorAnalysis adapters ────────────────────────────────

function skillsToText(resume: Resume): string {
  const skills = resume.skills
  if (!skills || typeof skills !== "object") {
    return (resume.top_skills ?? []).join(", ")
  }
  const parts: string[] = []
  for (const [category, items] of Object.entries(skills)) {
    if (!Array.isArray(items) || items.length === 0) continue
    const label = category.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
    parts.push(`${label}: ${items.join(", ")}`)
  }
  return parts.join("\n") || (resume.top_skills ?? []).join(", ")
}

function experienceToDraft(resume: Resume): { company: string; role: string; description: string }[] {
  return (resume.work_experience ?? []).map((w) => ({
    company: w.company ?? "",
    role: w.title ?? "",
    description: [
      w.description ?? "",
      ...(w.achievements ?? []),
    ]
      .filter(Boolean)
      .join("\n"),
  }))
}

// ── ATS-aware analysis ────────────────────────────────────────────────────────

export interface AtsTailorResult {
  analysis: TailorAnalysisResult
  atsProfile: AtsProfile
  /** AI-generated ATS-optimized summary (null if AI unavailable or errored) */
  atsSummaryRewrite: string | null
  /** Keywords flagged as critical for this ATS strategy */
  criticalKeywords: string[]
  /** Human-readable ATS strategy tip for the popup */
  strategyTip: string
}

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null

async function generateAtsSummaryRewrite(
  currentSummary: string,
  jobTitle: string | null,
  company: string | null,
  jobDescription: string,
  missingKeywords: string[],
  presentKeywords: string[],
  profile: AtsProfile,
  resume: Resume
): Promise<string | null> {
  if (!anthropic) return null

  const name = resume.full_name ?? "the candidate"
  const currentRole = resume.primary_role ?? resume.work_experience?.[0]?.title ?? null
  const topSkills = (resume.top_skills ?? []).slice(0, 6).join(", ")
  const yearsExp = resume.years_of_experience ?? null

  const prompt = `You are rewriting a professional resume summary to pass through ${profile.name} ATS parsing AND impress the human recruiter who reads it next.

ATS STRATEGY FOR ${profile.name.toUpperCase()}:
${profile.summaryInstruction}

CANDIDATE CONTEXT (do not invent anything not listed here):
- Name: ${name}
- Current/target role: ${currentRole ?? "not specified"}
- Years of experience: ${yearsExp ?? "not specified"}
- Top skills: ${topSkills || "not listed"}
- Existing summary: "${currentSummary || "(empty)"}"

TARGET JOB:
- Title: ${jobTitle ?? "not specified"}
- Company: ${company ?? "not specified"}
- JD excerpt: ${jobDescription.slice(0, 1500)}

KEYWORDS ALREADY IN RESUME (reinforce these): ${presentKeywords.slice(0, 8).join(", ") || "none"}
KEYWORDS MISSING FROM RESUME (add only if truthfully applicable): ${missingKeywords.slice(0, 6).join(", ") || "none"}

RULES:
1. Use only skills and experience truthfully present in the candidate's history
2. Never invent job titles, companies, metrics, or technologies not already in the resume
3. Follow the ATS strategy for ${profile.name} exactly
4. Maximum 3 sentences
5. First sentence must contain the target job title or a close variant
6. Sound like a real person wrote it — no clichés like "results-driven", "passionate", "dynamic"

Return ONLY the rewritten summary text. No commentary, no labels, no quotes.`

  try {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 300,
      system:
        "You are an expert resume writer who specializes in ATS optimization. " +
        "You write summaries that pass ATS parsers AND make recruiters stop scrolling. " +
        "Output only the requested text — nothing else.",
      messages: [{ role: "user", content: prompt }],
    })

    const text = message.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim()
      // Strip any accidental quotes or labels
      .replace(/^["']|["']$/g, "")
      .replace(/^(Summary:|Profile:|Rewritten summary:)\s*/i, "")

    return text || null
  } catch (err) {
    console.warn("[ats-tailor] Claude summary rewrite failed:", err)
    return null
  }
}

/**
 * Run a full ATS-aware tailoring analysis for a resume vs. a job.
 *
 * Uses `buildLocalTailorAnalysis` for structural checks (skill gaps, weak bullets,
 * summary alignment) then overlays ATS-specific guidance and — when an AI key
 * is available — generates a Claude-written ATS-optimized summary rewrite.
 */
export async function tailorResumeForAts(
  resume: Resume,
  jobDescription: string,
  jobTitle: string | null,
  company: string | null,
  ats: string | null | undefined
): Promise<AtsTailorResult> {
  const profile = getAtsProfile(ats)
  const skillsText = skillsToText(resume)
  const experienceDraft = experienceToDraft(resume)

  const analysis = buildLocalTailorAnalysis({
    resume,
    jobDescription,
    skillsText,
    profileSummary: resume.summary ?? "",
    experienceDraft,
  })

  // For exact-match ATS (Workday, iCIMS), surface ONLY exact-match gaps — semantic
  // proximity is not enough to pass their parser.
  const criticalKeywords = profile.keywordStrategy === "exact"
    ? analysis.missingKeywords
    : analysis.missingKeywords.filter((kw) => {
        // For balanced/semantic ATS, only flag if the word doesn't even appear
        // in any form in the analysis present set
        const n = normalizeKeyword(kw)
        return !analysis.presentKeywords.some(
          (p) => normalizeKeyword(p) === n || normalizeKeyword(p).includes(n) || n.includes(normalizeKeyword(p))
        )
      })

  // ATS-specific strategy tip for the popup
  const keywordCount = criticalKeywords.length
  const score = analysis.matchScore
  let strategyTip: string
  if (profile.keywordStrategy === "exact") {
    strategyTip = keywordCount > 0
      ? `${profile.name} uses exact keyword matching. Add these ${keywordCount} exact phrase${keywordCount !== 1 ? "s" : ""} verbatim: ${criticalKeywords.slice(0, 4).join(", ")}${keywordCount > 4 ? ` (+${keywordCount - 4} more)` : ""}.`
      : `${profile.name} uses exact keyword matching — your resume already contains the critical terms.`
  } else if (score >= 70) {
    strategyTip = `Strong ${profile.name} alignment (${score}%). Focus on polishing your summary and first bullets per role.`
  } else {
    strategyTip = `${profile.name} scores keyword coverage — surface ${criticalKeywords.slice(0, 3).join(", ")}${criticalKeywords.length > 3 ? " and more" : ""} more explicitly in your bullets or skills section.`
  }

  // Generate ATS-optimized summary rewrite via Claude
  const atsSummaryRewrite = await generateAtsSummaryRewrite(
    resume.summary ?? "",
    jobTitle,
    company,
    jobDescription,
    criticalKeywords,
    analysis.presentKeywords,
    profile,
    resume
  )

  return {
    analysis,
    atsProfile: profile,
    atsSummaryRewrite,
    criticalKeywords,
    strategyTip,
  }
}
