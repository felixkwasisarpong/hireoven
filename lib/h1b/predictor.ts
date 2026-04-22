/**
 * H1B approval-likelihood prediction engine.
 *
 * Two stages:
 *   1. `predictH1BApproval` - fast, Bayesian + rule-based, pure Supabase
 *      reads. Safe to call in batch from the job feed.
 *   2. `deepH1BAnalysis` - optional Claude Sonnet narrative, gated behind a
 *      Pro International plan and only triggered from the drawer.
 *
 * Model overview:
 *   The employer sub-score is a Beta-Binomial posterior over approval rate,
 *   shrunk toward a SOC-code base rate (or a global prior when SOC is
 *   unknown). This naturally handles small-sample employers - a first-time
 *   filer with 0 records gets the SOC base rate as its posterior mean, but
 *   with a wide credible interval that pulls the "reported" score down.
 *   Title, location, and wage-vs-prevailing remain deterministic modifiers.
 *
 * NOTE: H1B only applies to positions in the United States. Non-US jobs are
 * returned with `isUSJob: false` and a stub "unknown" verdict - the UI uses
 * this flag to skip rendering the badge entirely.
 */

import Anthropic from '@anthropic-ai/sdk'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizeEmployerName } from '@/lib/h1b/lca-importer'
import type {
  EmployerLCAStats,
  H1BConfidence,
  H1BPrediction,
  H1BPredictionInput,
  H1BRecord,
  H1BVerdict,
  LCARecord,
  PredictionSignal,
} from '@/types'

// ---------------------------------------------------------------------------
// US detection
// ---------------------------------------------------------------------------

export const US_STATE_ABBRS = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID',
  'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO',
  'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA',
  'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'PR',
])

const HIGH_VOLUME_STATES = new Set(['CA', 'WA', 'TX', 'NY', 'NJ', 'IL', 'MA', 'VA', 'GA', 'FL'])

export function isLikelyUSJob(location: string | null, state: string | null, isRemote: boolean): boolean {
  if (state && US_STATE_ABBRS.has(state.toUpperCase())) return true
  if (!location) return isRemote // remote jobs w/ no location - assume US default
  const loc = location.toLowerCase()
  if (/\b(usa|united states|u\.s\.|u\.s\.a\.|us)\b/.test(loc)) return true
  for (const abbr of US_STATE_ABBRS) {
    if (loc.includes(`, ${abbr.toLowerCase()}`)) return true
  }
  // If we see anything that looks like a non-US country, reject.
  if (
    /\b(canada|toronto|vancouver|london|dublin|berlin|paris|amsterdam|bengaluru|bangalore|hyderabad|singapore|sydney|tokyo|mexico|brazil|remote - emea|remote - latam|united kingdom|germany|france|spain|italy|netherlands|australia|india|china|japan|ireland|portugal|poland|argentina|colombia|uk)\b/.test(
      loc
    )
  ) {
    return false
  }
  return true
}

export function extractStateFromLocation(location: string | null): string | null {
  if (!location) return null
  const match = location.match(/\b([A-Z]{2})\b/g)
  if (!match) return null
  for (const m of match) {
    if (US_STATE_ABBRS.has(m)) return m
  }
  return null
}

// ---------------------------------------------------------------------------
// Job title classification
// ---------------------------------------------------------------------------

type TitleRisk = { score: number; category: string; detail: string }

const HIGH_TITLE_PATTERNS: Array<[RegExp, TitleRisk]> = [
  [
    /\b(software|backend|frontend|full[- ]?stack|mobile|ios|android|platform|infrastructure)\s+(engineer|developer)|\bswe\b/i,
    { score: 90, category: 'Software engineering', detail: 'Software engineering titles are among the most commonly-approved H1B roles.' },
  ],
  [
    /\b(ml|machine learning|ai|artificial intelligence|deep learning|nlp|computer vision)\s+(engineer|scientist|researcher)/i,
    { score: 92, category: 'ML / AI', detail: 'ML / AI engineer roles map cleanly to SOC 15-2051 and carry a high approval rate.' },
  ],
  [
    /\b(data)\s+(scientist|engineer|analyst)\b/i,
    { score: 88, category: 'Data', detail: 'Data roles have a strong approval track record at tech employers.' },
  ],
  [
    /\b(devops|sre|site reliability|cloud|platform)\s+(engineer)?/i,
    { score: 87, category: 'DevOps / Cloud', detail: 'DevOps / SRE titles map to SOC 15-1244 with high approval rates.' },
  ],
  [
    /\b(electrical|mechanical|chemical|civil|hardware)\s+engineer/i,
    { score: 88, category: 'Licensed engineering', detail: 'Licensed engineering disciplines are clearly H1B-eligible and widely approved.' },
  ],
  [
    /\b(financial|quantitative|risk|actuarial)\s+(analyst|associate)/i,
    { score: 85, category: 'Finance', detail: 'Financial analyst roles at banks are a well-trodden H1B path.' },
  ],
  [
    /\b(accountant|cpa|tax\s+associate)\b/i,
    { score: 85, category: 'Accounting', detail: 'Accounting titles are commonly approved when degree requirements are documented.' },
  ],
  [
    /\b(product\s+manager|technical\s+product)/i,
    { score: 82, category: 'Product management', detail: 'PM roles at tech employers are routinely approved when the degree requirement is clear.' },
  ],
]

const MEDIUM_TITLE_PATTERNS: Array<[RegExp, TitleRisk]> = [
  [
    /\b(business|marketing|operations|program)\s+(analyst|manager)/i,
    { score: 68, category: 'Business', detail: 'Business / marketing / ops titles are approvable but face more scrutiny on degree relevance.' },
  ],
  [
    /\b(ux|ui|product)\s+designer/i,
    { score: 70, category: 'Design', detail: 'Design roles are approvable but USCIS sometimes questions specialty-occupation fit.' },
  ],
  [
    /\b(research\s+scientist|research\s+associate)/i,
    { score: 72, category: 'Research', detail: 'Research roles are generally approvable but RFEs are common.' },
  ],
  [
    /\b(project\s+manager)/i,
    { score: 66, category: 'Project management', detail: 'PjM titles are approvable but need a strong degree-to-role tie.' },
  ],
]

const RISKY_TITLE_PATTERNS: Array<[RegExp, TitleRisk]> = [
  [
    /\b(consultant|it\s+consultant)\b/i,
    { score: 45, category: 'Consultant', detail: 'Generic "consultant" titles and IT staff-aug roles face heavy USCIS scrutiny on end-client placement.' },
  ],
  [
    /\b(staffing|placement|recruitment)\b/i,
    { score: 35, category: 'Staffing', detail: 'Staffing / placement roles carry among the highest denial rates.' },
  ],
  [
    /\b(specialist|coordinator|associate)\b(?!\s+(engineer|developer|scientist|analyst))/i,
    { score: 52, category: 'Vague title', detail: 'Vague titles like "specialist" often face questions on specialty-occupation requirements.' },
  ],
  [
    /\b(manager|analyst)\b(?!\s+(\w))/i,
    { score: 55, category: 'Generic title', detail: '"Manager" or "Analyst" without domain context often triggers RFEs.' },
  ],
]

function scoreTitle(title: string, normalizedTitle: string | null): TitleRisk {
  const hay = `${normalizedTitle ?? ''} ${title}`.toLowerCase()
  for (const [re, risk] of HIGH_TITLE_PATTERNS) if (re.test(hay)) return risk
  for (const [re, risk] of MEDIUM_TITLE_PATTERNS) if (re.test(hay)) return risk
  for (const [re, risk] of RISKY_TITLE_PATTERNS) if (re.test(hay)) return risk
  return {
    score: 62,
    category: 'Uncategorized',
    detail: 'Role does not match our risk taxonomy - using a neutral baseline.',
  }
}

// ---------------------------------------------------------------------------
// Wage scoring
// ---------------------------------------------------------------------------

function annualizeWage(amount: number | null, unit: string | null): number | null {
  if (amount === null || amount <= 0) return null
  const u = (unit ?? 'year').toLowerCase()
  if (u.startsWith('year')) return amount
  if (u.startsWith('month')) return amount * 12
  if (u.startsWith('week')) return amount * 52
  if (u.startsWith('bi-w') || u.startsWith('biweek')) return amount * 26
  if (u.startsWith('hour')) return amount * 2080
  return amount
}

async function estimatePrevailingWage(
  socCode: string | null,
  stateAbbr: string | null
): Promise<{ median: number; sampleSize: number } | null> {
  if (!socCode && !stateAbbr) return null
  const supabase = createAdminClient()
  let query = supabase
    .from('lca_records')
    .select('prevailing_wage, prevailing_wage_unit')
    .not('prevailing_wage', 'is', null)
    .in('case_status', ['Certified', 'Certified-Withdrawn'])
    .limit(500)

  if (socCode) query = query.eq('soc_code', socCode)
  if (stateAbbr) query = query.eq('worksite_state_abbr', stateAbbr)

  const { data } = await query
  const rows = (data ?? []) as Array<{
    prevailing_wage: number | null
    prevailing_wage_unit: string | null
  }>
  const annualized = rows
    .map((r) => annualizeWage(r.prevailing_wage, r.prevailing_wage_unit))
    .filter((n): n is number => n !== null && n > 10_000 && n < 1_500_000)

  if (annualized.length === 0) return null
  annualized.sort((a, b) => a - b)
  const median = annualized[Math.floor(annualized.length / 2)]
  return { median, sampleSize: annualized.length }
}

// ---------------------------------------------------------------------------
// Bayesian employer posterior
// ---------------------------------------------------------------------------
//
// We model an employer's approval outcome as:
//     X | p  ~  Binomial(n, p)
//     p     ~  Beta(alpha0, beta0)  where
//     alpha0 = kappa * priorMean
//     beta0  = kappa * (1 - priorMean)
//
// The posterior after observing `certified` successes and `denied` failures
// is Beta(alpha0 + certified, beta0 + denied). We report:
//   - posterior mean           (probability of next petition being approved)
//   - posterior stddev         (uncertainty, drives confidence level)
//   - lower credible bound     (normal approximation; used to avoid
//                               overconfidence on 0-data employers)
//
// `kappa` is the effective number of "pseudo-observations" in the prior. A
// small value lets actual employer data dominate quickly; a large value keeps
// small-sample employers shrunk toward the base rate.

const PRIOR_STRENGTH = 25

/**
 * Fallback SOC base rates used only when `soc_base_rates` table is empty
 * (i.e. no LCA data has been imported yet). Once the importer has run at
 * least once, the DB-backed cache below takes precedence. Numbers are rounded
 * aggregates from public DOL disclosure files.
 */
const FALLBACK_SOC_BASE_RATES: Record<string, number> = {
  '15-1252': 0.98, '15-1253': 0.97, '15-1254': 0.97, '15-1255': 0.96,
  '15-1299': 0.92, '15-2051': 0.98, '15-2041': 0.97, '15-1244': 0.96,
  '15-1241': 0.95, '15-1232': 0.88, '15-1212': 0.95, '15-1221': 0.95,
  '17-2061': 0.97, '17-2071': 0.97, '17-2072': 0.97, '17-2141': 0.97,
  '17-2112': 0.96, '17-2051': 0.97, '11-3021': 0.95, '11-2021': 0.93,
  '11-9111': 0.93, '13-2011': 0.95, '13-2051': 0.96, '13-1161': 0.94,
  '13-1111': 0.91, '13-1082': 0.93, '19-1042': 0.96, '25-1021': 0.96,
  '27-1024': 0.88, '27-1014': 0.92, '29-1141': 0.95,
}

const GLOBAL_BASE_RATE = 0.96
const SOC_CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour

type SOCCacheEntry = { rate: number; sampleSize: number }
let SOC_CACHE: Map<string, SOCCacheEntry> | null = null
let SOC_CACHE_LOADED_AT = 0
let SOC_CACHE_INFLIGHT: Promise<void> | null = null

async function ensureSOCCache(): Promise<Map<string, SOCCacheEntry>> {
  const now = Date.now()
  if (SOC_CACHE && now - SOC_CACHE_LOADED_AT < SOC_CACHE_TTL_MS) {
    return SOC_CACHE
  }
  if (SOC_CACHE_INFLIGHT) {
    await SOC_CACHE_INFLIGHT
    return SOC_CACHE ?? new Map()
  }
  SOC_CACHE_INFLIGHT = (async () => {
    const supabase = createAdminClient()
    const { data } = await supabase
      .from('soc_base_rates')
      .select('soc_code, approval_rate, sample_size')
    const next = new Map<string, SOCCacheEntry>()
    for (const row of (data ?? []) as Array<{
      soc_code: string
      approval_rate: number | null
      sample_size: number
    }>) {
      if (row.approval_rate === null) continue
      next.set(row.soc_code, {
        rate: Number(row.approval_rate),
        sampleSize: row.sample_size,
      })
    }
    SOC_CACHE = next
    SOC_CACHE_LOADED_AT = Date.now()
  })().finally(() => {
    SOC_CACHE_INFLIGHT = null
  })
  await SOC_CACHE_INFLIGHT
  return SOC_CACHE ?? new Map()
}

/** Force a refresh the next time `getSOCBaseRate` runs. Useful after an import. */
export function invalidateSOCBaseRateCache(): void {
  SOC_CACHE = null
  SOC_CACHE_LOADED_AT = 0
}

async function getSOCBaseRate(
  socCode: string | null | undefined
): Promise<{ rate: number; source: 'soc-db' | 'soc-fallback' | 'global' }> {
  if (!socCode) return { rate: GLOBAL_BASE_RATE, source: 'global' }
  const trimmed = socCode.trim().replace(/\.\d+$/, '')

  const cache = await ensureSOCCache()
  const hit = cache.get(trimmed)
  if (hit) return { rate: hit.rate, source: 'soc-db' }

  // Major-group fallback from the DB cache when exact code not seen yet.
  if (cache.size > 0) {
    const major = trimmed.slice(0, 3) // e.g. "15-" prefix
    let num = 0
    let den = 0
    for (const [code, entry] of cache) {
      if (code.startsWith(major)) {
        num += entry.rate * entry.sampleSize
        den += entry.sampleSize
      }
    }
    if (den > 100) return { rate: num / den, source: 'soc-db' }
  }

  const stat = FALLBACK_SOC_BASE_RATES[trimmed]
  if (stat !== undefined) return { rate: stat, source: 'soc-fallback' }

  const major2 = trimmed.slice(0, 2)
  if (major2 === '15' || major2 === '17') {
    return { rate: 0.96, source: 'soc-fallback' }
  }
  if (major2 === '11' || major2 === '13') {
    return { rate: 0.93, source: 'soc-fallback' }
  }
  return { rate: GLOBAL_BASE_RATE, source: 'global' }
}

type BetaPosterior = {
  mean: number
  stddev: number
  lowerBound: number
  sampleSize: number
  priorMean: number
  priorSource: 'soc' | 'global'
}

function betaBinomialPosterior(
  certified: number,
  denied: number,
  priorMean: number,
  priorSource: 'soc' | 'global',
  priorStrength: number = PRIOR_STRENGTH
): BetaPosterior {
  const n = Math.max(0, certified + denied)
  const alphaPrior = priorStrength * priorMean
  const betaPrior = priorStrength * (1 - priorMean)
  const alphaPost = alphaPrior + certified
  const betaPost = betaPrior + denied
  const sum = alphaPost + betaPost
  const mean = alphaPost / sum
  const variance = (alphaPost * betaPost) / (sum * sum * (sum + 1))
  const stddev = Math.sqrt(variance)
  // Normal approximation to Beta for a rough lower 90% credible bound. This is
  // good enough for a UI pill and cheap to compute. We clamp to [0, 1].
  const lowerBound = Math.max(0, Math.min(1, mean - 1.2816 * stddev))
  return {
    mean,
    stddev,
    lowerBound,
    sampleSize: n,
    priorMean,
    priorSource,
  }
}

// ---------------------------------------------------------------------------
// Employer stats lookup
// ---------------------------------------------------------------------------
//
// We consult two data sources in parallel:
//
//   - `employer_lca_stats` - aggregated DOL LCA disclosures. Large sample
//      size but LCA-stage only (~97% certified industry-wide).
//   - `h1b_records`        - USCIS H-1B Employer Data Hub, per-year approved
//      and denied counts. Smaller sample but this is the *real* approval
//      outcome at the I-129 stage.
//
// When USCIS data is present and meaningful (>=5 decided petitions), we use
// those counts in the Beta-Binomial posterior. Otherwise we fall back to the
// LCA cert rate. Either way we surface the chosen source in the UI signal.

type EmployerSignal = {
  certified: number
  denied: number
  source: 'uscis' | 'lca' | 'none'
  yearsCovered: number[]
}

async function fetchEmployerStats(
  companyId: string | null,
  companyName: string
): Promise<{
  lca: EmployerLCAStats | null
  uscis: EmployerSignal | null
}> {
  const supabase = createAdminClient()
  const norm = normalizeEmployerName(companyName)

  const lcaPromise = (async (): Promise<EmployerLCAStats | null> => {
    if (companyId) {
      const { data } = await supabase
        .from('employer_lca_stats')
        .select('*')
        .eq('company_id', companyId)
        .order('total_applications', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (data) return data as EmployerLCAStats
    }
    if (!norm) return null
    const { data } = await supabase
      .from('employer_lca_stats')
      .select('*')
      .eq('employer_name_normalized', norm)
      .maybeSingle()
    return (data ?? null) as EmployerLCAStats | null
  })()

  const uscisPromise = (async (): Promise<EmployerSignal | null> => {
    if (!companyId) return null
    const { data } = await supabase
      .from('h1b_records')
      .select('year, approved, denied')
      .eq('company_id', companyId)
      .order('year', { ascending: false })
      .limit(6)
    const rows = (data ?? []) as Array<Pick<H1BRecord, 'year' | 'approved' | 'denied'>>
    if (rows.length === 0) return null
    let approved = 0
    let denied = 0
    const years: number[] = []
    for (const row of rows) {
      approved += row.approved ?? 0
      denied += row.denied ?? 0
      if (row.year !== null) years.push(row.year)
    }
    return {
      certified: approved,
      denied,
      source: 'uscis',
      yearsCovered: years.sort((a, b) => a - b),
    }
  })()

  const [lca, uscis] = await Promise.all([lcaPromise, uscisPromise])
  return { lca, uscis }
}

/**
 * Choose between USCIS (I-129) and LCA (DOL) counts as the observed data for
 * the Bayesian posterior. USCIS is the stronger signal - it's the actual
 * approval decision - so we prefer it whenever we have enough evidence.
 */
function pickEmployerSignal(
  lca: EmployerLCAStats | null,
  uscis: EmployerSignal | null
): EmployerSignal {
  const USCIS_MIN = 5
  if (uscis && uscis.certified + uscis.denied >= USCIS_MIN) {
    return uscis
  }
  if (lca) {
    return {
      certified: lca.total_certified,
      denied: lca.total_denied,
      source: 'lca',
      yearsCovered: Object.keys(lca.stats_by_year ?? {})
        .map(Number)
        .filter(Number.isFinite)
        .sort((a, b) => a - b),
    }
  }
  if (uscis) return uscis
  return { certified: 0, denied: 0, source: 'none', yearsCovered: [] }
}

// ---------------------------------------------------------------------------
// Main prediction
// ---------------------------------------------------------------------------

export async function predictH1BApproval(
  input: H1BPredictionInput
): Promise<H1BPrediction> {
  const stateGuess = input.state ?? extractStateFromLocation(input.location)
  const isUS = isLikelyUSJob(input.location, stateGuess, input.isRemote)

  if (!isUS) {
    return {
      approvalLikelihood: 0,
      confidenceLevel: 'low',
      verdict: 'unknown',
      employerScore: 0,
      jobTitleScore: 0,
      locationScore: 0,
      wageScore: null,
      signals: [
        {
          factor: 'Outside United States',
          impact: 'neutral',
          weight: 'high',
          detail: 'H1B applies only to US-based roles. This listing appears to be outside the US.',
        },
      ],
      employerStats: null,
      missingSalary: true,
      missingEmployerData: true,
      summary: 'H1B prediction is only meaningful for US-based jobs.',
      topRisk: null,
      computedAt: new Date().toISOString(),
      isUSJob: false,
    }
  }

  // --- 1. Employer posterior -------------------------------------------
  // Beta-Binomial with SOC-code shrinkage. The posterior mean is our estimate
  // of P(approval | employer, SOC). The lower credible bound is blended into
  // the reported employer score so that small-sample employers are honestly
  // uncertain rather than artificially optimistic.
  const [{ lca, uscis }, socBaseRateResult] = await Promise.all([
    fetchEmployerStats(input.company.id, input.company.name),
    getSOCBaseRate(input.socCode),
  ])
  const stats = lca
  const missingEmployerData = lca === null && uscis === null
  const signal = pickEmployerSignal(lca, uscis)

  const { rate: socBaseRate, source: priorSource } = socBaseRateResult
  // Normalize the prior source into the shape the posterior expects (the
  // posterior itself only cares about "soc" vs "global"; the richer
  // `soc-db / soc-fallback` distinction is only used in signal copy).
  const posteriorPriorSource: 'soc' | 'global' =
    priorSource === 'global' ? 'global' : 'soc'
  const posterior = betaBinomialPosterior(
    signal.certified,
    signal.denied,
    socBaseRate,
    posteriorPriorSource
  )
  // Blend the posterior mean with its lower credible bound, weighting by
  // sample size. Small-sample employers report the (cautious) lower bound;
  // well-documented employers report essentially the posterior mean. This
  // prevents "~98% approval" on a company with zero records just because the
  // SOC base rate happens to be high.
  const dataWeight =
    posterior.sampleSize / (posterior.sampleSize + PRIOR_STRENGTH)
  const reportedEmployerRate =
    dataWeight * posterior.mean + (1 - dataWeight) * posterior.lowerBound
  let employerScore = Math.round(reportedEmployerRate * 100)
  const employerSignals: PredictionSignal[] = []

  const priorSourceLabel =
    priorSource === 'soc-db'
      ? 'SOC (DOL-derived)'
      : priorSource === 'soc-fallback'
        ? 'SOC (fallback)'
        : 'global'

  if (signal.source !== 'none') {
    const empiricalRate =
      signal.certified + signal.denied > 0
        ? signal.certified / (signal.certified + signal.denied)
        : posterior.mean

    const sourceLabel = signal.source === 'uscis' ? 'USCIS I-129' : 'DOL LCA'

    // Headline signal - always shown when we have any data for this employer.
    employerSignals.push({
      factor: `Employer posterior (${sourceLabel})`,
      impact:
        posterior.mean >= 0.9
          ? 'positive'
          : posterior.mean >= 0.75
            ? 'neutral'
            : 'negative',
      weight:
        posterior.sampleSize >= 50
          ? 'high'
          : posterior.sampleSize >= 10
            ? 'medium'
            : 'low',
      detail: `${input.company.name}: ${Math.round(posterior.mean * 100)}% approval posterior (lower bound ~${Math.round(
        posterior.lowerBound * 100
      )}%) from ${posterior.sampleSize.toLocaleString()} ${
        signal.source === 'uscis' ? 'USCIS petitions' : 'LCA filings'
      }, shrunk toward a ${Math.round(socBaseRate * 100)}% ${priorSourceLabel} prior.`,
    })

    if (signal.source === 'uscis' && stats) {
      // We had both sources; note that we chose USCIS for the score.
      employerSignals.push({
        factor: 'Using USCIS I-129 data',
        impact: 'neutral',
        weight: 'low',
        detail: `${stats.total_certified.toLocaleString()} certified LCAs are also on record but the posterior uses the USCIS petition outcome, which is the actual approval decision.`,
      })
    }

    if (empiricalRate >= 0.95 && posterior.sampleSize >= 50) {
      employerSignals.push({
        factor: 'Consistent approval history',
        impact: 'positive',
        weight: 'high',
        detail: `Raw approval rate is ${Math.round(empiricalRate * 100)}% across ${posterior.sampleSize.toLocaleString()} observations - the posterior is tightly concentrated.`,
      })
    }
    if (stats?.has_high_denial_rate) {
      employerSignals.push({
        factor: 'Elevated denial rate (LCA)',
        impact: 'negative',
        weight: 'high',
        detail: `${Math.round((1 - (stats.certification_rate ?? 0)) * 100)}% of recent LCAs for this employer were denied or withdrawn.`,
      })
    }
    if (stats?.is_staffing_firm) {
      employerSignals.push({
        factor: 'Staffing firm risk',
        impact: 'negative',
        weight: 'medium',
        detail: 'Staffing and third-party placement patterns face heavier USCIS scrutiny at the I-129 stage, even when the LCA is certified.',
      })
    }
    if (posterior.sampleSize < 5) {
      employerSignals.push({
        factor: 'Small sample',
        impact: 'neutral',
        weight: 'medium',
        detail: 'Fewer than 5 observations on record - the posterior leans heavily on the SOC-code prior and the credible interval is wide.',
      })
    }
    if (stats?.approval_trend === 'improving') {
      employerSignals.push({
        factor: 'Improving trend',
        impact: 'positive',
        weight: 'medium',
        detail: 'Approval rate for this employer has trended up over the last 3 years.',
      })
    } else if (stats?.approval_trend === 'declining') {
      employerSignals.push({
        factor: 'Declining trend',
        impact: 'negative',
        weight: 'medium',
        detail: 'Approval rate for this employer has trended down over the last 3 years.',
      })
    }
  } else {
    employerSignals.push({
      factor: 'No employer records found',
      impact: 'neutral',
      weight: 'medium',
      detail: `${input.company.name} is not present in our USCIS or LCA databases - score defaults to the ${Math.round(
        socBaseRate * 100
      )}% ${priorSourceLabel} prior with a wide uncertainty band.`,
    })
  }

  // --- 2. Title --------------------------------------------------------
  const titleRisk = scoreTitle(input.jobTitle, input.normalizedTitle)
  const jobTitleScore = titleRisk.score
  const titleSignal: PredictionSignal = {
    factor: `Role type - ${titleRisk.category}`,
    impact: jobTitleScore >= 75 ? 'positive' : jobTitleScore >= 60 ? 'neutral' : 'negative',
    weight: jobTitleScore >= 85 || jobTitleScore < 50 ? 'high' : 'medium',
    detail: titleRisk.detail,
  }

  // --- 3. Location ------------------------------------------------------
  let locationScore = 70
  if (input.isRemote) locationScore = 80
  else if (stateGuess && HIGH_VOLUME_STATES.has(stateGuess)) locationScore = 85
  else if (stateGuess) locationScore = 68

  const locationSignal: PredictionSignal = {
    factor: 'Location',
    impact: locationScore >= 80 ? 'positive' : 'neutral',
    weight: 'low',
    detail: input.isRemote
      ? 'Remote US positions typically reference the employer’s primary worksite - usually a high-volume state.'
      : stateGuess && HIGH_VOLUME_STATES.has(stateGuess)
        ? `${stateGuess} is a high-volume H1B state with established processing patterns.`
        : 'Outside the top H1B states - fewer reference data points but not a disqualifier.',
  }

  // --- 4. Wage ----------------------------------------------------------
  let wageScore: number | null = null
  const salaryMid = computeSalaryMidpoint(input.salaryMin, input.salaryMax)
  const missingSalary = salaryMid === null
  let wageSignal: PredictionSignal | null = null

  if (salaryMid !== null) {
    const prevailing = await estimatePrevailingWage(input.socCode ?? null, stateGuess)
    if (prevailing) {
      const ratio = salaryMid / prevailing.median
      if (ratio >= 1.2) wageScore = 95
      else if (ratio >= 1.0) wageScore = 80
      else if (ratio >= 0.9) wageScore = 55
      else wageScore = 25

      wageSignal = {
        factor: 'Wage vs prevailing',
        impact: wageScore >= 75 ? 'positive' : wageScore >= 60 ? 'neutral' : 'negative',
        weight: wageScore < 60 ? 'high' : 'medium',
        detail:
          wageScore < 60
            ? 'Offered salary is close to or below the prevailing wage - USCIS scrutinises Level I wages heavily.'
            : `Offered salary is ${Math.round((ratio - 1) * 100)}% above the local prevailing wage (n=${prevailing.sampleSize}).`,
      }
    }
  }

  if (missingSalary) {
    wageSignal = {
      factor: 'Salary not disclosed',
      impact: 'neutral',
      weight: 'medium',
      detail: 'Cannot assess wage-level risk without salary data - prediction uses employer and role patterns only.',
    }
  }

  // --- 5. Weighted score -----------------------------------------------
  // The Bayesian employer posterior is the dominant signal - it already
  // encodes employer history, SOC prior, and uncertainty. Title/wage/location
  // are smaller modifiers that capture orthogonal information (role-type risk
  // not yet reflected in the prior, wage-level red flags, geography).
  let approvalLikelihood: number
  if (wageScore !== null) {
    approvalLikelihood =
      employerScore * 0.65 +
      jobTitleScore * 0.15 +
      wageScore * 0.15 +
      locationScore * 0.05
  } else {
    approvalLikelihood =
      employerScore * 0.75 + jobTitleScore * 0.2 + locationScore * 0.05
  }
  approvalLikelihood = Math.round(approvalLikelihood)

  // --- 6. Confidence ---------------------------------------------------
  // Driven primarily by posterior stddev (tight posterior = high confidence)
  // and secondarily by whether we have wage data to corroborate the score.
  let confidenceLevel: H1BConfidence
  if (posterior.sampleSize >= 50 && posterior.stddev < 0.04) {
    confidenceLevel = 'high'
  } else if (posterior.sampleSize >= 10 && posterior.stddev < 0.08) {
    confidenceLevel = missingSalary ? 'medium' : 'high'
  } else if (posterior.sampleSize >= 3) {
    confidenceLevel = 'medium'
  } else {
    confidenceLevel = 'low'
  }

  // --- 7. Verdict ------------------------------------------------------
  // Reserve "unknown" for the case where we truly can't commit - no employer
  // history AND no wage data AND the prior is the generic global one (i.e.
  // we don't even have a role-specific SOC fallback).
  let verdict: H1BVerdict
  if (
    missingEmployerData &&
    missingSalary &&
    priorSource === 'global' &&
    confidenceLevel === 'low'
  ) {
    verdict = 'unknown'
  } else if (approvalLikelihood >= 80) verdict = 'strong'
  else if (approvalLikelihood >= 65) verdict = 'good'
  else if (approvalLikelihood >= 45) verdict = 'moderate'
  else verdict = 'risky'

  // --- 8. Signals ------------------------------------------------------
  const allSignals: PredictionSignal[] = [...employerSignals, titleSignal, locationSignal]
  if (wageSignal) allSignals.push(wageSignal)

  const weightOrder = { high: 3, medium: 2, low: 1 } as const
  allSignals.sort((a, b) => weightOrder[b.weight] - weightOrder[a.weight])
  const signals = allSignals.slice(0, 5)

  const topRisk =
    signals.find((s) => s.impact === 'negative' && s.weight === 'high')?.factor ?? null

  // --- 9. Summary ------------------------------------------------------
  const summary = buildSummary({
    verdict,
    company: input.company.name,
    stats,
    titleCategory: titleRisk.category,
    missingSalary,
    topRisk,
    approvalLikelihood,
    signals,
  })

  return {
    approvalLikelihood,
    confidenceLevel,
    verdict,
    employerScore: Math.round(employerScore),
    jobTitleScore: Math.round(jobTitleScore),
    locationScore: Math.round(locationScore),
    wageScore: wageScore === null ? null : Math.round(wageScore),
    signals,
    employerStats: stats
      ? {
          totalApplications: stats.total_applications,
          certificationRate: stats.certification_rate ?? 0,
          trend: stats.approval_trend ?? null,
          isStaffingFirm: stats.is_staffing_firm,
          dataYears: Object.keys(stats.stats_by_year ?? {})
            .map(Number)
            .filter(Number.isFinite)
            .sort((a, b) => a - b),
        }
      : null,
    missingSalary,
    missingEmployerData,
    summary,
    topRisk,
    computedAt: new Date().toISOString(),
    isUSJob: true,
  }
}

function computeSalaryMidpoint(
  min: number | null,
  max: number | null
): number | null {
  if (min != null && max != null) return (min + max) / 2
  if (min != null) return min
  if (max != null) return max
  return null
}

function buildSummary(args: {
  verdict: H1BVerdict
  company: string
  stats: EmployerLCAStats | null
  titleCategory: string
  missingSalary: boolean
  topRisk: string | null
  approvalLikelihood: number
  signals: PredictionSignal[]
}): string {
  const { verdict, company, stats, titleCategory, missingSalary, topRisk, approvalLikelihood } = args

  if (verdict === 'unknown') {
    return `Limited data available for ${company}. Prediction is based on job title and location patterns only - research this employer's H1B history independently.`
  }
  if (verdict === 'strong') {
    const rate = stats
      ? `${Math.round((stats.certification_rate ?? 0) * 100)}%`
      : 'a strong'
    return `${company} has ${rate} H1B approval track record. This ${titleCategory.toLowerCase()} role type is commonly approved. ${
      missingSalary ? 'Salary isn’t disclosed - confirm it meets the prevailing wage if you receive an offer.' : 'Offered salary looks healthy vs prevailing wage.'
    }`
  }
  if (verdict === 'good') {
    return `${company} looks workable for H1B (~${approvalLikelihood}% approval likelihood) for this ${titleCategory.toLowerCase()} role. ${
      topRisk ? `Watch for: ${topRisk.toLowerCase()}.` : ''
    }`.trim()
  }
  if (verdict === 'moderate') {
    return `Mixed signals for this filing (~${approvalLikelihood}% approval likelihood). ${
      topRisk ? `Biggest factor: ${topRisk.toLowerCase()}.` : ''
    } Consider verifying the wage level and end-client details before committing.`.trim()
  }
  return `Elevated H1B risk for this filing (~${approvalLikelihood}%). ${
    topRisk ? `${topRisk}.` : ''
  } Consider negotiating salary above prevailing wage and researching this employer's recent approval history with an immigration attorney.`.trim()
}

// ---------------------------------------------------------------------------
// Deep (Claude) analysis - premium, on-demand
// ---------------------------------------------------------------------------

export async function deepH1BAnalysis(
  input: H1BPredictionInput,
  fastPrediction: H1BPrediction,
  recentLCARecords: LCARecord[]
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return 'Deep H1B analysis is unavailable - Anthropic credentials are not configured.'
  }

  const client = new Anthropic({ apiKey })

  const model = process.env.H1B_CLAUDE_MODEL ?? 'claude-sonnet-4-5'
  const recordSummary = recentLCARecords
    .slice(0, 10)
    .map(
      (r) =>
        `- FY${r.fiscal_year ?? '?'} · ${r.job_title ?? 'Unknown title'} · ${
          r.worksite_state_abbr ?? '??'
        } · wage level ${r.wage_level ?? '?'} · ${r.case_status ?? 'Unknown'}`
    )
    .join('\n') || '(No recent LCA records on file.)'

  const systemPrompt = `You are an immigration-data analyst. You explain H1B approval
likelihood in clear, factual, 3–4 paragraph assessments. You never give legal
advice. You always close with a "What to do" line with 2-3 concrete actions.
Be honest about uncertainty. Cite numbers the user provided; do not invent new statistics.`

  const userPrompt = `Job: ${input.jobTitle}
Company: ${input.company.name}
Location: ${input.location ?? 'Unknown'}${input.isRemote ? ' (remote)' : ''}
Salary band: ${input.salaryMin ?? 'n/a'} - ${input.salaryMax ?? 'n/a'}
Seniority: ${input.seniorityLevel ?? 'unspecified'}
SOC (if inferred): ${input.socCode ?? 'unknown'}

Fast prediction summary:
  verdict: ${fastPrediction.verdict}
  approval likelihood: ~${fastPrediction.approvalLikelihood}%
  confidence: ${fastPrediction.confidenceLevel}
  employer score: ${fastPrediction.employerScore}
  title score: ${fastPrediction.jobTitleScore}
  wage score: ${fastPrediction.wageScore ?? 'n/a'}
  location score: ${fastPrediction.locationScore}

Signals:
${fastPrediction.signals.map((s) => `- [${s.impact}/${s.weight}] ${s.factor}: ${s.detail}`).join('\n')}

Recent LCA records for this employer:
${recordSummary}

Description excerpt:
${(input.description ?? '').slice(0, 900)}

Write a 3–4 paragraph assessment of this H1B filing's realistic approval outlook.
Cover: employer pattern, role fit with SOC, wage level risk, and what to watch
for. End with a "What to do" line containing 2–3 concrete user actions.`

  const response = await client.messages.create({
    model,
    max_tokens: 900,
    temperature: 0.2,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  })

  const firstText = response.content.find((c) => c.type === 'text')
  return firstText && firstText.type === 'text'
    ? firstText.text
    : 'Deep analysis returned no content.'
}
