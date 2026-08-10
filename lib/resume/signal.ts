/**
 * Resume Signal Detection.
 *
 * Answers "what field is this resume actually signalling?" — the gap the founder
 * hit: a diverse Fintech+AI resume defaults to reading as Fintech, and no
 * matcher tells you that or helps you re-tilt it before matching.
 *
 * v1 is a transparent, deterministic scorer: each field has a signature of
 * strong signals (skills, tools, role-title terms); we score the resume's text
 * against every field and rank them. Later this can be made corpus-driven
 * (score against centroids of real jobs per field), but the shape stays the same.
 *
 * Pure module — no DB/network — so it's easy to unit-test and safe to import
 * anywhere.
 */

import type { Resume } from "@/types"

export interface FieldSignature {
  key: string
  label: string
  /** Strong signals — skills, tools, and role-title terms for the field. */
  signals: string[]
  /** Extra-strong signals (weighted 2×): the terms that unambiguously mean this field. */
  strong?: string[]
}

export interface FieldFit {
  key: string
  label: string
  /** 0–100 relative signal strength. */
  score: number
  /** Signature signals found in the resume. */
  matched: string[]
  /** Notable signature signals NOT found (the positioning gap). */
  missing: string[]
}

export interface ResumeSignal {
  /** All fields with any signal, strongest first. */
  fields: FieldFit[]
  /** The single strongest field. */
  primary: FieldFit | null
  /**
   * True when a second field is nearly as strong as the primary — i.e. the
   * resume sends a split/ambiguous signal (the "Fintech + AI" case). That's the
   * moment to tell the user to pick a lane and sharpen.
   */
  split: boolean
  runnerUp: FieldFit | null
}

// ── Field signatures ────────────────────────────────────────────────────────
// Tech specialisations first (where "diverse resume" ambiguity bites hardest),
// then broader domains so non-tech resumes still classify.
const FIELDS: FieldSignature[] = [
  {
    key: "ai_ml",
    label: "AI / Machine Learning",
    strong: ["machine learning", "deep learning", "llm", "nlp", "generative ai", "mlops", "pytorch", "tensorflow", "computer vision"],
    signals: ["ai", "ml", "model", "neural network", "data scientist", "applied scientist", "hugging face", "langchain", "rag", "embeddings", "fine-tuning", "scikit", "keras", "transformers", "prompt"],
  },
  {
    key: "fintech",
    label: "Fintech / Financial Services",
    strong: ["fintech", "payments", "banking", "trading", "quant", "brokerage", "lending", "kyc", "aml", "ledger"],
    signals: ["financial", "finance", "risk", "fraud", "blockchain", "defi", "crypto", "settlement", "reconciliation", "stripe", "plaid", "compliance", "capital markets", "underwriting", "credit"],
  },
  {
    key: "data",
    label: "Data / Analytics",
    strong: ["data analyst", "analytics", "sql", "tableau", "power bi", "dbt", "data warehouse"],
    signals: ["etl", "bi", "looker", "snowflake", "bigquery", "redshift", "pandas", "dashboards", "reporting", "data pipeline", "metrics"],
  },
  {
    key: "data_eng",
    label: "Data Engineering",
    strong: ["data engineer", "spark", "kafka", "airflow", "etl pipeline"],
    signals: ["hadoop", "flink", "databricks", "streaming", "ingestion", "warehouse", "pipelines", "dbt", "orchestration"],
  },
  {
    key: "backend",
    label: "Backend Engineering",
    strong: ["backend", "microservices", "distributed systems", "api", "golang"],
    signals: ["java", "python", "node", "go", "rest", "grpc", "postgres", "redis", "kafka", "scalability", "server", "spring", "django"],
  },
  {
    key: "frontend",
    label: "Frontend Engineering",
    strong: ["frontend", "react", "next.js", "typescript"],
    signals: ["javascript", "vue", "angular", "css", "tailwind", "ui", "web", "redux", "html", "svelte"],
  },
  {
    key: "devops",
    label: "DevOps / Cloud / SRE",
    strong: ["devops", "sre", "kubernetes", "terraform", "ci/cd"],
    signals: ["aws", "gcp", "azure", "docker", "ansible", "helm", "observability", "infrastructure", "cloud", "jenkins", "prometheus"],
  },
  {
    key: "security",
    label: "Security",
    strong: ["security", "infosec", "penetration testing", "siem", "cissp"],
    signals: ["soc", "iam", "vulnerability", "threat", "compliance", "encryption", "incident response", "owasp", "zero trust"],
  },
  {
    key: "mobile",
    label: "Mobile Engineering",
    strong: ["ios", "android", "swift", "kotlin", "react native"],
    signals: ["flutter", "objective-c", "mobile", "app store", "jetpack", "swiftui"],
  },
  {
    key: "product",
    label: "Product Management",
    strong: ["product manager", "product management", "roadmap", "prd"],
    signals: ["backlog", "stakeholder", "user research", "a/b test", "prioritization", "go-to-market", "kpis", "discovery"],
  },
  {
    key: "design",
    label: "Design / UX",
    strong: ["ux", "ui design", "product design", "figma"],
    signals: ["wireframe", "prototype", "user research", "design system", "sketch", "interaction design", "usability"],
  },
  {
    key: "sales",
    label: "Sales",
    strong: ["account executive", "sales", "quota", "pipeline"],
    signals: ["prospecting", "crm", "salesforce", "closing", "b2b", "revenue", "outbound", "sdr"],
  },
  {
    key: "marketing",
    label: "Marketing / Growth",
    strong: ["marketing", "growth", "seo", "demand generation"],
    signals: ["content", "campaign", "brand", "social media", "ppc", "email marketing", "acquisition", "hubspot"],
  },
  {
    key: "finance_ops",
    label: "Finance / Accounting",
    strong: ["accounting", "financial analyst", "fp&a", "cpa"],
    signals: ["audit", "gaap", "budgeting", "forecasting", "controller", "bookkeeping", "tax", "excel", "financial modeling"],
  },
]

// Saturation constant: ~this many weighted hits ≈ a strong (~80%) signal.
const SATURATION = 5

function buildBlob(resume: Pick<Resume,
  "primary_role" | "top_skills" | "skills" | "work_experience" | "industries" | "summary" | "raw_text"
>): { text: string; tokens: Set<string> } {
  const parts: string[] = []
  if (resume.primary_role) parts.push(resume.primary_role)
  if (resume.summary) parts.push(resume.summary)
  for (const s of resume.top_skills ?? []) parts.push(s)
  for (const s of resume.skills?.technical ?? []) parts.push(s)
  for (const i of resume.industries ?? []) parts.push(i)
  for (const w of resume.work_experience ?? []) {
    if (w.title) parts.push(w.title)
    if (w.description) parts.push(w.description)
    for (const a of w.achievements ?? []) parts.push(a)
  }
  // raw_text last and capped — it's the fallback, not the primary signal.
  if (resume.raw_text) parts.push(resume.raw_text.slice(0, 20_000))

  const text = ` ${parts.join(" ").toLowerCase()} `
  const tokens = new Set(text.split(/[^a-z0-9+#.]+/).filter(Boolean))
  return { text, tokens }
}

function hasSignal(signal: string, blob: { text: string; tokens: Set<string> }): boolean {
  const s = signal.toLowerCase()
  // Multi-word or long single tokens → phrase/substring match.
  if (s.includes(" ") || s.length >= 5) return blob.text.includes(s)
  // Short tokens (ai, ml, go, c#, sql) → exact token match to avoid "email"→"ai".
  return blob.tokens.has(s)
}

export function detectResumeSignal(
  resume: Pick<Resume,
    "primary_role" | "top_skills" | "skills" | "work_experience" | "industries" | "summary" | "raw_text"
  >,
): ResumeSignal {
  const blob = buildBlob(resume)

  const fields: FieldFit[] = FIELDS.map((f) => {
    const strong = new Set((f.strong ?? []).map((s) => s.toLowerCase()))
    const all = [...new Set([...(f.strong ?? []), ...f.signals])]
    const matched: string[] = []
    const missing: string[] = []
    let weighted = 0
    for (const sig of all) {
      if (hasSignal(sig, blob)) {
        matched.push(sig)
        weighted += strong.has(sig.toLowerCase()) ? 2 : 1
      } else {
        missing.push(sig)
      }
    }
    const score = Math.round(100 * (1 - Math.exp(-weighted / SATURATION)))
    return {
      key: f.key,
      label: f.label,
      score,
      matched,
      // Surface the missing STRONG signals first — those are the highest-leverage
      // gaps to close when re-positioning toward this field.
      missing: missing
        .sort((a, b) => Number(strong.has(b.toLowerCase())) - Number(strong.has(a.toLowerCase())))
        .slice(0, 6),
    }
  })
    .filter((f) => f.score > 0)
    .sort((a, b) => b.score - a.score)

  const primary = fields[0] ?? null
  const runnerUp = fields[1] ?? null
  // Split signal when the runner-up is ≥70% as strong as the primary.
  const split = Boolean(primary && runnerUp && primary.score > 0 && runnerUp.score / primary.score >= 0.7)

  return { fields, primary, runnerUp, split }
}
