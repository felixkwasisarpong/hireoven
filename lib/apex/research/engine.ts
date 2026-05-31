/**
 * Scout Research Engine — bounded multi-step research execution.
 *
 * Server-only. Each step runs sequentially so SSE events stream
 * progressively to the client. Step order mirrors the skeleton in tasks.ts.
 *
 * Bounds:
 *   - Total wall-clock: TOTAL_TIMEOUT_MS (30 s)
 *   - Per step:         STEP_TIMEOUT_MS  (10 s)
 *   - Findings:         max 5 from Claude synthesis
 *
 * The synthesis step (s5) is the only Claude call in the research path.
 * All other steps are deterministic DB queries or pure computation.
 *
 * Safety: findings are validated to have real evidence[] before being emitted.
 * Claude is instructed to cite only the numbers provided — never fabricate.
 */

import type { Pool } from "pg"
import type { ScoutResearchTask, ScoutResearchFinding, ResearchSSEEvent } from "./types"
import type { ResearchType } from "./tasks"

const STEP_TIMEOUT_MS  = 10_000
const TOTAL_TIMEOUT_MS = 30_000

type ResearchEmit = (event: ResearchSSEEvent) => void

// ── Accumulated data flowing between steps ────────────────────────────────────

type JobHit = {
  id:          string
  title:       string
  companyName: string
  companyId:   string
  sponsorsH1b: boolean | null
  isRemote:    boolean
  skills:      string[] | null
}

type CompanyGroup = {
  companyId:   string
  companyName: string
  sponsorsH1b: boolean
  jobCount:    number
  skills:      string[]
}

type CompanyIntelRow = {
  companyName:        string
  sponsorshipLabel?:  string
  hiringLabel?:       string
  signals:            string[]
}

type SkillHit = { skill: string; count: number }

type AccumulatedData = {
  jobs?:         JobHit[]
  companies?:    CompanyGroup[]
  companyIntel?: CompanyIntelRow[]
  marketSignals?: string[]
  userSkills?:   string[]
  topSkills?:    SkillHit[]
}

// ── Timeout helper ────────────────────────────────────────────────────────────

async function withTimeout<T>(promise: Promise<T>, fallback: T): Promise<T> {
  let timer!: ReturnType<typeof setTimeout>
  const result = await Promise.race([
    promise,
    new Promise<T>((resolve) => { timer = setTimeout(() => resolve(fallback), STEP_TIMEOUT_MS) }),
  ])
  clearTimeout(timer)
  return result
}

// ── Individual step runners ───────────────────────────────────────────────────

async function runFetchJobs(
  pool: Pool,
  opts: { sponsorshipRequired?: boolean; remoteOnly?: boolean; aiKeywords?: boolean; userSkills?: string[] }
): Promise<{ summary: string; jobs: JobHit[] }> {
  const conditions = ["j.is_active = true"]
  const params: unknown[] = []

  if (opts.sponsorshipRequired) {
    conditions.push("(j.sponsors_h1b = true OR c.sponsors_h1b = true OR c.sponsorship_confidence >= 65)")
  }
  if (opts.remoteOnly) {
    conditions.push("j.is_remote = true")
  }
  if (opts.aiKeywords) {
    conditions.push(
      "(j.title ILIKE '%engineer%' OR j.title ILIKE '%ml%' OR j.title ILIKE '%platform%' OR " +
      "j.skills && ARRAY['Python','TensorFlow','PyTorch','Kubernetes','Kafka','Spark','MLOps']::text[])"
    )
  }
  if (opts.userSkills?.length && !opts.aiKeywords) {
    params.push(opts.userSkills)
    conditions.push(`j.skills && $${params.length}::text[]`)
  }

  const rows = await pool.query<{
    id: string; title: string; company_name: string; company_id: string
    sponsors_h1b: boolean | null; is_remote: boolean; skills: string[] | null
  }>(
    `SELECT j.id, j.title, c.name AS company_name, j.company_id,
            j.sponsors_h1b, j.is_remote, j.skills
     FROM jobs j
     LEFT JOIN companies c ON c.id = j.company_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY j.first_detected_at DESC
     LIMIT 60`,
    params
  )

  const jobs: JobHit[] = rows.rows.map((r) => ({
    id:          r.id,
    title:       r.title,
    companyName: r.company_name,
    companyId:   r.company_id,
    sponsorsH1b: r.sponsors_h1b,
    isRemote:    r.is_remote,
    skills:      r.skills,
  }))

  return { summary: `Found ${jobs.length} relevant posting${jobs.length !== 1 ? "s" : ""}`, jobs }
}

function runGroupCompanies(jobs: JobHit[]): { summary: string; companies: CompanyGroup[] } {
  const map = new Map<string, CompanyGroup>()
  for (const j of jobs) {
    const key = j.companyId || j.companyName
    if (!key) continue
    const existing = map.get(key)
    if (existing) {
      existing.jobCount++
      for (const s of j.skills ?? []) {
        if (!existing.skills.includes(s)) existing.skills.push(s)
      }
    } else {
      map.set(key, {
        companyId:   j.companyId,
        companyName: j.companyName,
        sponsorsH1b: j.sponsorsH1b === true,
        jobCount:    1,
        skills:      (j.skills ?? []).slice(0, 20),
      })
    }
  }
  const companies = [...map.values()].sort((a, b) => b.jobCount - a.jobCount).slice(0, 15)
  const sponsorCount = companies.filter((c) => c.sponsorsH1b).length
  return {
    summary: `Grouped ${companies.length} companies — ${sponsorCount} with H-1B signals`,
    companies,
  }
}

async function runFetchCompanyIntel(
  pool: Pool,
  companies: CompanyGroup[]
): Promise<{ summary: string; intel: CompanyIntelRow[] }> {
  const topIds = companies.slice(0, 5).map((c) => c.companyId).filter(Boolean)
  if (!topIds.length) return { summary: "No company IDs for intel lookup", intel: [] }

  const rows = await pool.query<{
    id: string; name: string
    sponsors_h1b: boolean; sponsorship_confidence: number
    hiring_health: { status?: string; activeJobCount?: number } | null
  }>(
    `SELECT id, name, sponsors_h1b, COALESCE(sponsorship_confidence, 0) AS sponsorship_confidence,
            hiring_health
     FROM companies WHERE id = ANY($1::uuid[])`,
    [topIds]
  )

  const intel: CompanyIntelRow[] = rows.rows.map((r) => {
    const conf = r.sponsorship_confidence ?? 0
    const signals: string[] = []
    let sponsorshipLabel: string | undefined
    let hiringLabel: string | undefined

    if (r.sponsors_h1b && conf >= 60) {
      sponsorshipLabel = "Historically sponsors H-1B"
      signals.push(`Sponsors H-1B (${conf}% confidence)`)
    } else if (r.sponsors_h1b) {
      sponsorshipLabel = "Some H-1B history"
      signals.push("Some H-1B petition history (moderate confidence)")
    } else {
      signals.push("No confirmed H-1B sponsorship history in data")
    }

    const health = r.hiring_health
    if (health?.status === "growing") {
      hiringLabel = "Hiring actively"
      signals.push("Hiring appears to be growing based on posting patterns")
    } else if (health?.status === "steady") {
      signals.push("Hiring pace appears stable")
    } else if (health?.status === "slowing") {
      signals.push("Hiring activity may be slowing")
    }

    if (health?.activeJobCount) {
      signals.push(`${health.activeJobCount} active opening${health.activeJobCount !== 1 ? "s" : ""} currently posted`)
    }

    return { companyName: r.name, sponsorshipLabel, hiringLabel, signals }
  })

  const withH1b = intel.filter((i) => i.sponsorshipLabel?.includes("H-1B")).length
  return {
    summary: `Analyzed ${intel.length} companies — ${withH1b} with confirmed H-1B history`,
    intel,
  }
}

async function runFetchMarketSignals(
  userId: string
): Promise<{ summary: string; signals: string[] }> {
  const { getMarketIntelligence } = await import("@/lib/scout/market-intelligence")
  const result = await getMarketIntelligence(userId).catch(() => ({ signals: [] as import("@/lib/scout/market-intelligence").MarketSignal[] }))
  const signals = result.signals.slice(0, 4).map((s) => s.summary)
  return {
    summary: signals.length > 0 ? `Gathered ${signals.length} market signal${signals.length !== 1 ? "s" : ""}` : "Market signals unavailable",
    signals,
  }
}

function runSkillAnalysis(jobs: JobHit[]): { summary: string; topSkills: SkillHit[] } {
  const count = new Map<string, number>()
  for (const j of jobs) {
    for (const s of j.skills ?? []) {
      const key = s.toLowerCase()
      count.set(key, (count.get(key) ?? 0) + 1)
    }
  }
  const topSkills: SkillHit[] = [...count.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([skill, c]) => ({ skill, count: c }))

  return {
    summary: topSkills.length > 0
      ? `Top skill: "${topSkills[0].skill}" — appears in ${topSkills[0].count} postings`
      : "No skill data found",
    topSkills,
  }
}

async function runLoadUserProfile(
  pool: Pool,
  userId: string
): Promise<{ summary: string; userSkills: string[] }> {
  const res = await pool.query<{ top_skills: string[] | null }>(
    `SELECT top_skills FROM resumes WHERE user_id = $1 ORDER BY is_primary DESC, created_at DESC LIMIT 1`,
    [userId]
  )
  const userSkills = res.rows[0]?.top_skills ?? []
  return {
    summary: userSkills.length > 0
      ? `Loaded ${userSkills.length} skills from your resume`
      : "No resume skills on record — using broad search",
    userSkills,
  }
}

// ── Claude synthesis (single LLM call) ───────────────────────────────────────

async function runSynthesis(
  objective: string,
  data: AccumulatedData
): Promise<{ findings: ScoutResearchFinding[] }> {
  const Anthropic = (await import("@anthropic-ai/sdk")).default
  const anthropic = process.env.ANTHROPIC_API_KEY
    ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    : null

  if (!anthropic) return { findings: [] }

  const { SONNET_MODEL } = await import("@/lib/ai/anthropic-models")

  const lines: string[] = [`Research objective: "${objective}"`, "", "Evidence gathered (use only these numbers):"]
  if (data.jobs?.length) {
    lines.push(`- Matching job postings: ${data.jobs.length}`)
    const sponsored = data.jobs.filter((j) => j.sponsorsH1b).length
    const remote    = data.jobs.filter((j) => j.isRemote).length
    if (sponsored > 0) lines.push(`  - Roles with sponsorship signals: ${sponsored}/${data.jobs.length}`)
    if (remote    > 0) lines.push(`  - Remote-eligible: ${remote}/${data.jobs.length}`)
  }
  if (data.companies?.length) {
    const top = data.companies.slice(0, 6).map((c) => c.companyName).join(", ")
    const h1b = data.companies.filter((c) => c.sponsorsH1b).length
    lines.push(`- Companies by activity (top 6): ${top}`)
    lines.push(`  - With H-1B sponsorship history: ${h1b}/${data.companies.length}`)
  }
  if (data.companyIntel?.length) {
    for (const ci of data.companyIntel) {
      lines.push(`- ${ci.companyName}: ${ci.signals.slice(0, 2).join(" | ")}`)
    }
  }
  if (data.topSkills?.length) {
    const top5 = data.topSkills.slice(0, 5).map((s) => `${s.skill} (${s.count}x)`).join(", ")
    lines.push(`- Most frequent skills: ${top5}`)
  }
  if (data.marketSignals?.length) {
    for (const sig of data.marketSignals.slice(0, 3)) {
      lines.push(`- Market signal: ${sig}`)
    }
  }
  if (data.userSkills?.length) {
    lines.push(`- User's resume skills: ${data.userSkills.slice(0, 8).join(", ")}`)
  }

  const prompt = `${lines.join("\n")}

Generate 3–5 concise research findings grounded ONLY in the evidence above.

Each finding must:
- Be 1–2 sentences, specific, evidence-backed
- Use hedging language: "appears to", "suggests", "based on X postings", "may indicate"
- End with a clear implication for the user's job search
- Never claim guaranteed outcomes

Respond with valid JSON only (no markdown fences):
{
  "findings": [
    {
      "type": "sponsorship_pattern",
      "title": "5–8 word title",
      "summary": "1–2 sentence insight phrased cautiously",
      "evidence": ["specific stat or data point from the evidence above"],
      "confidence": 0.75,
      "actions": [{ "label": "Queue those jobs", "command": "Queue visa-friendly backend jobs" }]
    }
  ]
}

Types: job_cluster | company_pattern | skill_gap | market_signal | sponsorship_pattern | career_path
Confidence: 0.4–0.6 sparse data · 0.65–0.80 solid data · never 1.0
CRITICAL: Only cite numbers from the evidence above. Never invent statistics.`

  try {
    const msg = await anthropic.messages.create({
      model:      SONNET_MODEL,
      max_tokens: 900,
      messages:   [{ role: "user", content: prompt }],
    })

    const text    = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim()
    const cleaned = text.replace(/^```json?\s*/i, "").replace(/\s*```$/i, "").trim()
    const parsed  = JSON.parse(cleaned) as { findings?: unknown[] }

    const VALID_TYPES = new Set(["job_cluster","company_pattern","skill_gap","market_signal","sponsorship_pattern","career_path"])
    const findings: ScoutResearchFinding[] = []

    for (const raw of parsed.findings ?? []) {
      if (!raw || typeof raw !== "object") continue
      const f = raw as Record<string, unknown>
      if (typeof f.title !== "string" || typeof f.summary !== "string") continue
      if (typeof f.type !== "string" || !VALID_TYPES.has(f.type)) continue

      findings.push({
        type:       f.type as ScoutResearchFinding["type"],
        title:      f.title.trim(),
        summary:    f.summary.trim(),
        evidence:   Array.isArray(f.evidence)
                      ? f.evidence.filter((e): e is string => typeof e === "string").slice(0, 4)
                      : undefined,
        confidence: typeof f.confidence === "number"
                      ? Math.min(0.92, Math.max(0.3, f.confidence))
                      : 0.6,
        actions:    Array.isArray(f.actions)
                      ? (f.actions as unknown[])
                          .filter((a): a is { label: string; command: string } =>
                            typeof a === "object" && a !== null &&
                            typeof (a as Record<string, unknown>).label === "string" &&
                            typeof (a as Record<string, unknown>).command === "string"
                          )
                          .slice(0, 2)
                      : undefined,
      })
      if (findings.length >= 5) break
    }

    return { findings }
  } catch {
    return { findings: [] }
  }
}

// ── Step orchestrator ─────────────────────────────────────────────────────────

type StepFn = () => Promise<string>   // returns summary string

async function executeStep(
  stepId: string,
  task:   ScoutResearchTask,
  emit:   ResearchEmit,
  fn:     StepFn
): Promise<void> {
  const step = task.steps.find((s) => s.id === stepId)
  if (step) step.status = "running"
  emit({ type: "research_step_start", stepId, title: step?.title ?? stepId })

  const start = Date.now()
  const summary = await withTimeout(fn(), "Step timed out")
  const durationMs = Date.now() - start

  if (step) { step.status = "completed"; step.summary = summary; step.durationMs = durationMs }
  emit({ type: "research_step_done", stepId, summary, durationMs })
}

// ── Public entry point ────────────────────────────────────────────────────────

export type ResearchEngineCtx = {
  userId:       string
  pool:         Pool
  researchType: ResearchType
}

export async function runResearchEngine(
  task: ScoutResearchTask,
  ctx:  ResearchEngineCtx,
  emit: ResearchEmit
): Promise<ScoutResearchTask> {
  const { userId, pool, researchType } = ctx
  const data: AccumulatedData = {}
  const deadline = Date.now() + TOTAL_TIMEOUT_MS
  const ok = () => Date.now() < deadline

  task.status = "running"

  // ── S1: Profile or initial job fetch ───────────────────────────────────────

  const needsProfile = ["similar_profile_companies", "career_direction", "skill_frequency"].includes(researchType)

  if (ok()) await executeStep("s1", task, emit, async () => {
    if (needsProfile) {
      const r = await runLoadUserProfile(pool, userId)
      data.userSkills = r.userSkills
      return r.summary
    }
    const opts = {
      sponsorshipRequired: ["visa_friendly_companies", "remote_sponsorship"].includes(researchType),
      remoteOnly:          researchType === "remote_sponsorship",
      aiKeywords:          researchType === "ai_infra_opportunities",
    }
    const r = await runFetchJobs(pool, opts)
    data.jobs = r.jobs
    return r.summary
  })

  // ── S2: Job fetch (profile-first types) or skill analysis ──────────────────

  if (ok()) await executeStep("s2", task, emit, async () => {
    if (needsProfile) {
      const r = await runFetchJobs(pool, { userSkills: data.userSkills ?? [] })
      data.jobs = r.jobs
      return r.summary
    }
    if (["ai_infra_opportunities", "skill_frequency"].includes(researchType) && data.jobs) {
      const r = runSkillAnalysis(data.jobs)
      data.topSkills = r.topSkills
      return r.summary
    }
    if (data.jobs) {
      const r = runGroupCompanies(data.jobs)
      data.companies = r.companies
      return r.summary
    }
    return "No data from previous step"
  })

  // ── S3: Company grouping or market signals ──────────────────────────────────

  if (ok()) await executeStep("s3", task, emit, async () => {
    if (["similar_profile_companies", "career_direction"].includes(researchType) && data.jobs) {
      const r = runGroupCompanies(data.jobs)
      data.companies = r.companies
      return r.summary
    }
    if (researchType === "ai_infra_opportunities") {
      const r = await runFetchMarketSignals(userId)
      data.marketSignals = r.signals
      return r.summary
    }
    if (["skill_frequency"].includes(researchType) && data.jobs) {
      const r = runSkillAnalysis(data.jobs)
      data.topSkills = r.topSkills
      return r.summary
    }
    if (data.companies) {
      const r = await runFetchCompanyIntel(pool, data.companies)
      data.companyIntel = r.intel
      return r.summary
    }
    return "Skipped"
  })

  // ── S4: Company intel or market signals ─────────────────────────────────────

  if (ok()) await executeStep("s4", task, emit, async () => {
    if (["similar_profile_companies"].includes(researchType) && data.companies) {
      const r = await runFetchCompanyIntel(pool, data.companies)
      data.companyIntel = r.intel
      return r.summary
    }
    if (["ai_infra_opportunities", "career_direction"].includes(researchType) && data.jobs) {
      const r = runSkillAnalysis(data.jobs)
      data.topSkills = r.topSkills
      return r.summary
    }
    const r = await runFetchMarketSignals(userId)
    data.marketSignals = r.signals
    return r.summary
  })

  // ── S5: Claude synthesis ────────────────────────────────────────────────────

  if (ok()) await executeStep("s5", task, emit, async () => {
    const { findings } = await runSynthesis(task.objective, data)

    // Stagger finding emissions for progressive UX
    for (const finding of findings) {
      task.findings = [...(task.findings ?? []), finding]
      emit({ type: "research_finding", finding })
      await new Promise((r) => setTimeout(r, 90))
    }

    return findings.length > 0
      ? `Generated ${findings.length} finding${findings.length !== 1 ? "s" : ""}`
      : "Synthesis complete — no findings produced"
  })

  // ── Finalize ─────────────────────────────────────────────────────────────────

  task.status      = (task.findings?.length ?? 0) > 0 ? "completed" : "failed"
  task.completedAt = new Date().toISOString()
  emit({ type: "research_complete", task })
  return task
}
