/**
 * Scout Career Strategy Engine — Types V1
 *
 * Advisory career direction analysis. Evidence-backed, cautiously phrased.
 *
 * Safety contract:
 *   - Never promise outcomes or rank human worth
 *   - Never infer protected traits from career patterns
 *   - Never fabricate market opportunities
 *   - All signals phrased with appropriate uncertainty
 */

// ── Career direction ──────────────────────────────────────────────────────────

export type ScoutCareerDirectionCategory =
  | "backend"
  | "platform"
  | "ai_engineering"
  | "infra"
  | "ml_platform"
  | "payments"
  | "security"
  | "fullstack"
  | "data"

export type ScoutCareerDirection = {
  id:                  string
  title:               string
  category:            ScoutCareerDirectionCategory

  /** 0–1. Reflects evidence quality — never absolute fit score. */
  confidence:          number

  /** Evidence sentences using cautious language */
  reasons?:            string[]
  suggestedSkills?:    string[]
  suggestedCompanies?: string[]
  suggestedRoles?:     string[]
}

// ── Full strategy result (returned by /api/scout/career) ─────────────────────

export type ScoutCareerStrategyResult = {
  directions:      ScoutCareerDirection[]
  /** 2–3 sentence strategic overview */
  summary:         string
  /** Where the user appears to get strongest traction */
  tractionSignals: string[]
  /** Skills or patterns appearing to block progression */
  gapSignals:      string[]
  generatedAt:     string
}

// ── UI metadata ───────────────────────────────────────────────────────────────

export const DIRECTION_CATEGORY_META: Record<
  ScoutCareerDirectionCategory,
  { label: string; accent: string; bg: string; dot: string }
> = {
  backend:       { label: "Backend Engineering",    accent: "text-blue-700",    bg: "bg-blue-50 border-blue-100",    dot: "bg-blue-500"    },
  platform:      { label: "Platform Engineering",   accent: "text-violet-700",  bg: "bg-violet-50 border-violet-100",dot: "bg-violet-500"  },
  ai_engineering:{ label: "AI Engineering",         accent: "text-rose-700",    bg: "bg-rose-50 border-rose-100",    dot: "bg-rose-500"    },
  infra:         { label: "Infrastructure / DevOps", accent: "text-slate-700",   bg: "bg-slate-50 border-slate-200",  dot: "bg-slate-500"   },
  ml_platform:   { label: "ML Platform",            accent: "text-orange-700",  bg: "bg-orange-50 border-orange-100",dot: "bg-orange-500"  },
  payments:      { label: "Payments / Fintech",     accent: "text-emerald-700", bg: "bg-emerald-50 border-emerald-100",dot:"bg-emerald-500" },
  security:      { label: "Security Engineering",   accent: "text-red-700",     bg: "bg-red-50 border-red-100",      dot: "bg-red-500"     },
  fullstack:     { label: "Full-Stack",             accent: "text-sky-700",     bg: "bg-sky-50 border-sky-100",      dot: "bg-sky-500"     },
  data:          { label: "Data Engineering",       accent: "text-amber-700",   bg: "bg-amber-50 border-amber-100",  dot: "bg-amber-500"   },
}
