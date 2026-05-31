/**
 * Scout Career Strategy Engine — data gathering + Claude synthesis.
 *
 * Server-only. Runs deterministic DB queries, then calls Claude once
 * to synthesise ScoutCareerDirection[] from the gathered evidence.
 *
 * Safety:
 *   - No inferences about protected traits
 *   - All directions evidence-backed and phrased with uncertainty
 *   - Confidence clamped 0.4–0.88
 *   - Claude explicitly instructed not to fabricate market data
 */

import type { Pool } from "pg"
import type { ScoutCareerDirection, ScoutCareerStrategyResult } from "./types"

// ── Direction keyword maps (for traction clustering) ──────────────────────────

const DIRECTION_KEYWORDS: Record<string, string[]> = {
  backend:        ["backend", "server", "api", "node", "python", "go", "java", "spring"],
  platform:       ["platform", "sre", "reliability", "developer experience", "devex"],
  ai_engineering: ["ai", "llm", "generative", "language model", "inference", "rlhf"],
  infra:          ["infrastructure", "cloud", "kubernetes", "terraform", "devops", "aws", "gcp", "azure"],
  ml_platform:    ["ml platform", "mlops", "machine learning platform", "model serving", "kubeflow"],
  payments:       ["payments", "fintech", "financial", "billing", "transaction", "banking"],
  security:       ["security", "auth", "identity", "cryptography", "appsec", "devsecops"],
  fullstack:      ["fullstack", "full-stack", "react", "typescript", "frontend", "next.js"],
  data:           ["data", "analytics", "pipeline", "warehouse", "spark", "kafka", "dbt", "airflow"],
}

function classifyTitle(title: string): string | null {
  const t = title.toLowerCase()
  for (const [cat, keywords] of Object.entries(DIRECTION_KEYWORDS)) {
    if (keywords.some((kw) => t.includes(kw))) return cat
  }
  return null
}

// ── DB query types ────────────────────────────────────────────────────────────

type ApplicationRow = {
  job_title:   string
  status:      string
  match_score: number | null
  is_remote:   boolean
}

type ResumeRow = {
  top_skills:     string[] | null
  seniority_level: string | null
  summary:        string | null
}

type SkillUnlockRow = {
  skill:    string
  job_count: number
}

type CareerPathRow = {
  target_role: string
  overlap_count: number
}

// ── Traction cluster ──────────────────────────────────────────────────────────

type TractionCluster = {
  category:    string
  total:       number
  positive:    number
  rate:        number
}

const POSITIVE_STATUSES = new Set(["phone_screen", "interview", "final_round", "offer", "hired"])

function computeTraction(apps: ApplicationRow[]): TractionCluster[] {
  const buckets = new Map<string, { total: number; positive: number }>()

  for (const app of apps) {
    const cat = classifyTitle(app.job_title)
    if (!cat) continue
    const b = buckets.get(cat) ?? { total: 0, positive: 0 }
    b.total++
    if (POSITIVE_STATUSES.has(app.status)) b.positive++
    buckets.set(cat, b)
  }

  return [...buckets.entries()]
    .filter(([, b]) => b.total >= 2)
    .map(([category, b]) => ({
      category,
      total:    b.total,
      positive: b.positive,
      rate:     b.total > 0 ? Math.round((b.positive / b.total) * 100) : 0,
    }))
    .sort((a, b) => b.rate - a.rate)
}

// ── Claude synthesis ──────────────────────────────────────────────────────────

async function synthesiseDirections(
  objective: string,
  resume:    ResumeRow | null,
  traction:  TractionCluster[],
  unlocks:   SkillUnlockRow[],
  paths:     CareerPathRow[],
  market:    string[],
): Promise<ScoutCareerStrategyResult> {
  const Anthropic = (await import("@anthropic-ai/sdk")).default
  const anthropic = process.env.ANTHROPIC_API_KEY
    ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    : null

  if (!anthropic) {
    return { directions: [], summary: "Career analysis unavailable.", tractionSignals: [], gapSignals: [], generatedAt: new Date().toISOString() }
  }

  const { SONNET_MODEL } = await import("@/lib/ai/anthropic-models")

  const lines: string[] = [`Career analysis request: "${objective}"`, ""]

  if (resume) {
    lines.push(`User profile:`)
    if (resume.seniority_level) lines.push(`- Seniority: ${resume.seniority_level}`)
    if (resume.top_skills?.length) lines.push(`- Top skills: ${resume.top_skills.slice(0, 12).join(", ")}`)
    if (resume.summary) lines.push(`- Summary: ${resume.summary.slice(0, 250)}`)
    lines.push("")
  }

  if (traction.length > 0) {
    lines.push("Application traction by role category (based on response rate):")
    for (const t of traction.slice(0, 5)) {
      lines.push(`- ${t.category}: ${t.positive}/${t.total} advanced (${t.rate}% response rate)`)
    }
    lines.push("")
  }

  if (unlocks.length > 0) {
    lines.push("Skill unlocks (adding these would open more opportunities):")
    for (const u of unlocks.slice(0, 5)) {
      lines.push(`- ${u.skill}: appears in ${u.job_count} additional roles`)
    }
    lines.push("")
  }

  if (paths.length > 0) {
    lines.push("Adjacent career paths identified (by skill overlap):")
    for (const p of paths.slice(0, 4)) {
      lines.push(`- ${p.target_role} (${p.overlap_count} skill overlaps)`)
    }
    lines.push("")
  }

  if (market.length > 0) {
    lines.push("Market signals:")
    for (const sig of market.slice(0, 3)) lines.push(`- ${sig}`)
    lines.push("")
  }

  const validCategories = Object.keys(DIRECTION_KEYWORDS).join(" | ")

  const prompt = `${lines.join("\n")}
Generate 2–4 career directions grounded ONLY in the data above. Be specific — cite actual patterns.

Rules:
- Use hedged language: "appears", "suggests", "based on patterns", "seems to"
- Never guarantee outcomes or rank human worth
- Never infer protected characteristics
- Never fabricate market data
- Confidence: 0.45–0.65 for sparse data, 0.65–0.80 for moderate data, 0.80–0.88 for strong data

Return valid JSON only:
{
  "directions": [
    {
      "id": "dir-1",
      "title": "Platform Engineering",
      "category": "platform",
      "confidence": 0.75,
      "reasons": ["evidence-backed reason"],
      "suggestedSkills": ["Kubernetes", "Terraform"],
      "suggestedCompanies": ["Stripe", "Cloudflare"],
      "suggestedRoles": ["Staff Platform Engineer", "Senior SRE"]
    }
  ],
  "summary": "2–3 sentences. Strategic overview using cautious language.",
  "tractionSignals": ["Pattern from traction data — e.g. 'Infra-focused roles appear to get stronger responses'"],
  "gapSignals": ["Skill or pattern that appears to limit opportunities"]
}

Valid categories: ${validCategories}`

  try {
    const msg = await anthropic.messages.create({
      model:      SONNET_MODEL,
      max_tokens: 1000,
      messages:   [{ role: "user", content: prompt }],
    })

    const text    = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim()
    const cleaned = text.replace(/^```json?\s*/i, "").replace(/\s*```$/i, "").trim()
    const parsed  = JSON.parse(cleaned) as {
      directions?:     unknown[]
      summary?:        string
      tractionSignals?: string[]
      gapSignals?:      string[]
    }

    const VALID_CATS = new Set(Object.keys(DIRECTION_KEYWORDS))
    const directions: ScoutCareerDirection[] = []

    for (const raw of parsed.directions ?? []) {
      if (!raw || typeof raw !== "object") continue
      const d = raw as Record<string, unknown>
      if (typeof d.title !== "string" || typeof d.category !== "string") continue
      if (!VALID_CATS.has(d.category)) continue

      directions.push({
        id:                  typeof d.id === "string" ? d.id : `dir-${directions.length + 1}`,
        title:               d.title,
        category:            d.category as ScoutCareerDirection["category"],
        confidence:          typeof d.confidence === "number"
                               ? Math.min(0.88, Math.max(0.4, d.confidence))
                               : 0.6,
        reasons:             Array.isArray(d.reasons)
                               ? (d.reasons as unknown[]).filter((r): r is string => typeof r === "string").slice(0, 4)
                               : undefined,
        suggestedSkills:     Array.isArray(d.suggestedSkills)
                               ? (d.suggestedSkills as unknown[]).filter((s): s is string => typeof s === "string").slice(0, 5)
                               : undefined,
        suggestedCompanies:  Array.isArray(d.suggestedCompanies)
                               ? (d.suggestedCompanies as unknown[]).filter((c): c is string => typeof c === "string").slice(0, 4)
                               : undefined,
        suggestedRoles:      Array.isArray(d.suggestedRoles)
                               ? (d.suggestedRoles as unknown[]).filter((r): r is string => typeof r === "string").slice(0, 4)
                               : undefined,
      })
      if (directions.length >= 4) break
    }

    return {
      directions,
      summary:         typeof parsed.summary === "string" ? parsed.summary : "Career strategy analysis complete.",
      tractionSignals: Array.isArray(parsed.tractionSignals)
                         ? (parsed.tractionSignals as unknown[]).filter((s): s is string => typeof s === "string").slice(0, 4)
                         : [],
      gapSignals:      Array.isArray(parsed.gapSignals)
                         ? (parsed.gapSignals as unknown[]).filter((s): s is string => typeof s === "string").slice(0, 4)
                         : [],
      generatedAt:     new Date().toISOString(),
    }
  } catch {
    return { directions: [], summary: "Could not synthesise career directions.", tractionSignals: [], gapSignals: [], generatedAt: new Date().toISOString() }
  }
}

// ── Public entry point ────────────────────────────────────────────────────────

export async function runCareerEngine(
  objective: string,
  userId:    string,
  pool:      Pool,
): Promise<ScoutCareerStrategyResult> {

  const [appRes, resumeRes, unlockRes, pathRes] = await Promise.allSettled([
    // Recent applications with status + match score for traction analysis
    pool.query<ApplicationRow>(
      `SELECT j.title AS job_title, ja.status, ja.match_score, j.is_remote
       FROM job_applications ja
       JOIN jobs j ON j.id = ja.job_id
       WHERE ja.user_id = $1 AND ja.is_archived = false
       ORDER BY ja.created_at DESC LIMIT 80`,
      [userId]
    ),

    // Resume: skills + seniority
    pool.query<ResumeRow>(
      `SELECT top_skills, seniority_level, summary
       FROM resumes WHERE user_id = $1
       ORDER BY is_primary DESC, created_at DESC LIMIT 1`,
      [userId]
    ),

    // Skill unlocks: skills appearing in jobs the user doesn't quite match
    pool.query<SkillUnlockRow>(
      `SELECT skill, COUNT(DISTINCT job_id)::int AS job_count
       FROM (
         SELECT j.id AS job_id, UNNEST(j.skills) AS skill
         FROM jobs j
         WHERE j.is_active = true
           AND NOT (j.skills && (
             SELECT COALESCE(top_skills, ARRAY[]::text[])
             FROM resumes WHERE user_id = $1
             ORDER BY is_primary DESC LIMIT 1
           ))
       ) sub
       WHERE LOWER(skill) NOT IN (
         SELECT LOWER(s)
         FROM (
           SELECT UNNEST(COALESCE(top_skills, ARRAY[]::text[])) AS s
           FROM resumes WHERE user_id = $1 ORDER BY is_primary DESC LIMIT 1
         ) skills_sub
       )
       GROUP BY skill
       HAVING COUNT(DISTINCT job_id) >= 5
       ORDER BY job_count DESC LIMIT 8`,
      [userId]
    ),

    // Adjacent career paths by skill overlap
    pool.query<CareerPathRow>(
      `SELECT j.title AS target_role,
              (SELECT COUNT(*) FROM UNNEST(j.skills) AS s
               WHERE LOWER(s) = ANY(
                 SELECT LOWER(sk)
                 FROM (SELECT UNNEST(COALESCE(top_skills, ARRAY[]::text[])) AS sk
                       FROM resumes WHERE user_id = $1
                       ORDER BY is_primary DESC LIMIT 1) skill_sub
               ))::int AS overlap_count
       FROM jobs j
       WHERE j.is_active = true
         AND j.skills IS NOT NULL
       ORDER BY overlap_count DESC LIMIT 20`,
      [userId]
    ),
  ])

  // Pull market signals (non-critical — don't fail if unavailable)
  let marketSignals: string[] = []
  try {
    const { getMarketIntelligence } = await import("@/lib/scout/market-intelligence")
    const intel = await getMarketIntelligence(userId).catch(() => ({ signals: [] }))
    marketSignals = intel.signals.slice(0, 3).map((s) => s.summary)
  } catch {}

  const apps    = appRes.status    === "fulfilled" ? appRes.value.rows    : []
  const resume  = resumeRes.status === "fulfilled" ? resumeRes.value.rows[0] ?? null : null
  const unlocks = unlockRes.status === "fulfilled" ? unlockRes.value.rows  : []
  const paths   = pathRes.status   === "fulfilled"
    ? pathRes.value.rows.filter((r) => r.overlap_count >= 3)
    : []

  const traction = computeTraction(apps)

  return synthesiseDirections(objective, resume, traction, unlocks, paths, marketSignals)
}
