/**
 * Apply-URL backsolver.
 *
 * Given an apply/job URL (often an aggregator redirector or a company careers
 * wrapper), follow the redirect chain and inspect HTML to find the underlying
 * ATS (ats_type + ats_identifier), then validate the board has live jobs. This
 * turns a raw apply URL from Adzuna/Dice/jSearch/etc. into an enrollable ATS
 * tenant.
 *
 * Reuses (does NOT reimplement):
 *   - detectAtsFromUrl   from lib/companies/detect-ats.ts        (URL → ATS)
 *   - detectAtsInHtml    from lib/companies/ats-url-resolver.ts  (HTML → ATS)
 *   - withAtsRateLimit   from lib/discovery/ats-rate-limiter.ts  (board hits)
 *
 * Note on redirects: Node/undici `fetch(redirect:'manual')` exposes the 3xx
 * status and Location header (verified — it is NOT an opaque redirect here), so
 * we follow the chain by hand rather than letting fetch auto-follow.
 */

import { detectAtsFromUrl } from "@/lib/companies/detect-ats"
import { detectAtsInHtml } from "@/lib/companies/ats-url-resolver"
import { withAtsRateLimit, QueueFullError } from "@/lib/discovery/ats-rate-limiter"
import { counter, histogram } from "@/lib/observability/metrics"

export interface ResolveResult {
  success: boolean
  atsType?: string
  atsIdentifier?: string
  confidence: number
  jobCount?: number
  sourceUrl: string
  finalUrl?: string
  sourceType?: string
  companyNameGuess?: string
  domainGuess?: string
  errorReason?:
    | "no_ats_match"
    | "board_error"
    | "fetch_failed"
    | "timeout"
    | "redirect_loop"
    | "rate_limited"
  hops?: number
}

const MAX_HOPS = 5
const MAX_BODY_BYTES = 2 * 1024 * 1024 // 2MB
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

/** Read lazily so tests can shrink the budget via env before calling. */
function timeoutMs(): number {
  const n = Number(process.env.ATS_RESOLVE_TIMEOUT_MS)
  return Number.isFinite(n) && n > 0 ? n : 10_000
}

// ── Board validators ─────────────────────────────────────────────────────────
// Per-ATS public board endpoint + a job-count extractor. Only the ATSes with a
// cheap public listing endpoint are validated; others are accepted as
// detected-but-unvalidated (moderate confidence).

function arrLen(x: unknown): number {
  return Array.isArray(x) ? x.length : 0
}

const VALIDATORS: Record<string, { url: (slug: string) => string; count: (text: string) => number }> = {
  greenhouse: {
    url: (s) => `https://boards-api.greenhouse.io/v1/boards/${s}/jobs`,
    count: (t) => arrLen((JSON.parse(t) as { jobs?: unknown[] }).jobs),
  },
  lever: {
    url: (s) => `https://api.lever.co/v0/postings/${s}?mode=json`,
    count: (t) => {
      const j = JSON.parse(t)
      return Array.isArray(j) ? j.length : 0
    },
  },
  ashby: {
    url: (s) => `https://api.ashbyhq.com/posting-api/job-board/${s}`,
    count: (t) => arrLen((JSON.parse(t) as { jobs?: unknown[] }).jobs),
  },
  smartrecruiters: {
    url: (s) => `https://api.smartrecruiters.com/v1/companies/${s}/postings`,
    count: (t) => {
      const j = JSON.parse(t) as { totalFound?: number; content?: unknown[] }
      return typeof j.totalFound === "number" ? j.totalFound : arrLen(j.content)
    },
  },
  workable: {
    url: (s) => `https://apply.workable.com/api/v1/widget/accounts/${s}`,
    count: (t) => arrLen((JSON.parse(t) as { jobs?: unknown[] }).jobs),
  },
  recruitee: {
    url: (s) => `https://${s}.recruitee.com/api/offers/`,
    count: (t) => arrLen((JSON.parse(t) as { offers?: unknown[] }).offers),
  },
  teamtailor: {
    url: (s) => `https://${s}.teamtailor.com/jobs.json`,
    count: (t) => {
      const j = JSON.parse(t)
      return Array.isArray(j) ? j.length : arrLen((j as { jobs?: unknown[] }).jobs)
    },
  },
  bamboohr: {
    // embed2.php returns HTML, not JSON — count job rows heuristically.
    url: (s) => `https://${s}.bamboohr.com/jobs/embed2.php`,
    count: (t) => (t.match(/jobs\/view\/\d+|view\.php\?id=\d+|BambooHR-ATS-Jobs-Item/gi) ?? []).length,
  },
}

type ValidationOutcome =
  | { kind: "jobs"; count: number }
  | { kind: "empty" }
  | { kind: "not_found" }
  | { kind: "board_error" }

async function validateBoard(atsType: string, slug: string): Promise<ValidationOutcome> {
  const validator = VALIDATORS[atsType]
  if (!validator) return { kind: "board_error" } // caller guards via hasValidator; defensive
  const url = validator.url(slug)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs())
  try {
    const res = await withAtsRateLimit(atsType, () =>
      fetch(url, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: { "user-agent": USER_AGENT, accept: "application/json, text/html;q=0.9,*/*;q=0.5" },
      }),
    )
    if (res.status === 404) {
      await safeCancel(res)
      return { kind: "not_found" }
    }
    if (!res.ok) {
      await safeCancel(res)
      return { kind: "board_error" }
    }
    const text = await readCappedText(res)
    let count = 0
    try {
      count = validator.count(text)
    } catch {
      count = 0
    }
    return count >= 1 ? { kind: "jobs", count } : { kind: "empty" }
  } catch (err) {
    if (err instanceof QueueFullError) throw err // bubble to the caller → 'rate_limited'
    // AbortError (our timeout), 5xx, or network error during validation.
    return { kind: "board_error" }
  } finally {
    clearTimeout(timer)
  }
}

// ── Redirect chain ───────────────────────────────────────────────────────────

type ChainResult = {
  urls: string[]
  finalUrl: string
  detection: { atsType: string; atsIdentifier: string | null } | null
  errorReason?: ResolveResult["errorReason"]
}

async function followChain(input: string): Promise<ChainResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs())
  const visited = new Set<string>()
  const urls: string[] = []
  let current = input
  try {
    for (let hop = 0; hop < MAX_HOPS; hop += 1) {
      urls.push(current)

      // Detect on every hop URL (including the input). First match wins — stop.
      const det = detectAtsFromUrl(current)
      if (det) {
        return { urls, finalUrl: current, detection: { atsType: det.atsType, atsIdentifier: det.atsIdentifier } }
      }
      if (visited.has(current)) {
        return { urls, finalUrl: current, detection: null, errorReason: "redirect_loop" }
      }
      visited.add(current)

      // Prefer HEAD; fall back to GET when the server rejects HEAD.
      let res = await doFetch(current, "HEAD", controller.signal)
      if (res.status === 405 || res.status === 501 || res.status === 403) {
        await safeCancel(res)
        res = await doFetch(current, "GET", controller.signal)
      }

      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location")
        await safeCancel(res)
        if (!loc) return { urls, finalUrl: current, detection: null } // dead redirect — settle here
        current = new URL(loc, current).toString()
        continue
      }

      // Non-redirect response — this is the final URL; HTML inspection happens next.
      await safeCancel(res)
      return { urls, finalUrl: current, detection: null }
    }
    // Still redirecting after MAX_HOPS — treat as a loop / runaway chain.
    return { urls, finalUrl: current, detection: null, errorReason: "redirect_loop" }
  } catch (err) {
    if (isAbortError(err)) return { urls, finalUrl: current, detection: null, errorReason: "timeout" }
    return { urls, finalUrl: current, detection: null, errorReason: "fetch_failed" }
  } finally {
    clearTimeout(timer)
  }
}

async function doFetch(url: string, method: "HEAD" | "GET", signal: AbortSignal): Promise<Response> {
  return fetch(url, {
    method,
    redirect: "manual", // we follow by hand to read Location at each hop
    signal,
    headers: { "user-agent": USER_AGENT, accept: "*/*" },
  })
}

async function fetchHtml(url: string): Promise<string | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs())
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": USER_AGENT,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.7",
      },
    })
    if (!res.ok) {
      await safeCancel(res)
      return null
    }
    return await readCappedText(res)
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

// ── Guess helpers ────────────────────────────────────────────────────────────

const REDIRECTOR_OR_ATS_HOST =
  /(adzuna|indeed|glassdoor|linkedin|ziprecruiter|dice|jooble|jsearch|google|bing|t\.co|bit\.ly|lnkd|greenhouse\.io|lever\.co|ashbyhq\.com|smartrecruiters\.com|myworkdayjobs\.com|workdayjobs\.com|icims\.com|jobvite\.com|recruitee\.com|bamboohr\.com|teamtailor\.com|workable\.com|taleo\.net|successfactors\.|oraclecloud\.com|phenompeople\.com|eightfold\.ai|avature\.net)/i

function apexOf(hostname: string): string {
  const labels = hostname.toLowerCase().split(".").filter(Boolean)
  if (labels.length <= 2) return labels.join(".")
  return labels.slice(-2).join(".")
}

/** Best-effort company domain: last non-ATS, non-redirector host in the chain. */
function guessDomain(chain: string[]): string | undefined {
  for (let i = chain.length - 1; i >= 0; i -= 1) {
    try {
      const host = new URL(chain[i]!).hostname
      if (!REDIRECTOR_OR_ATS_HOST.test(host)) return apexOf(host)
    } catch {
      // skip malformed
    }
  }
  return undefined
}

/** Best-effort company name from the page <title> (trimmed of site suffixes). */
function guessNameFromHtml(html: string | null): string | undefined {
  if (!html) return undefined
  const m = /<title[^>]*>([^<]+)<\/title>/i.exec(html)
  if (!m) return undefined
  const raw = m[1]!.replace(/\s+/g, " ").trim()
  const head = raw.split(/[|\-–—·:]/)[0]?.trim()
  return head && head.length > 0 ? head : undefined
}

// ── Small fetch utilities ────────────────────────────────────────────────────

function isAbortError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === "AbortError" || (err as { code?: string }).code === "ABORT_ERR")
  )
}

async function safeCancel(res: Response): Promise<void> {
  try {
    await res.body?.cancel()
  } catch {
    // ignore
  }
}

async function readCappedText(res: Response): Promise<string> {
  if (!res.body) return res.text()
  const reader = res.body.getReader()
  const chunks: Buffer[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        chunks.push(Buffer.from(value))
        total += value.byteLength
        if (total >= MAX_BODY_BYTES) {
          try {
            await reader.cancel()
          } catch {
            // ignore
          }
          break
        }
      }
    }
  } catch {
    // partial body is fine for detection
  }
  return Buffer.concat(chunks).toString("utf8")
}

// ── Public entry point ───────────────────────────────────────────────────────

export async function resolveApplyUrlToAtsTenant(
  applyUrl: string,
  sourceType?: string,
): Promise<ResolveResult> {
  const st = sourceType ?? "unknown"
  const t0 = Date.now()
  counter("apply_url.backsolve.attempt", { sourceType: st })
  const result = await resolveApplyUrlToAtsTenantImpl(applyUrl, sourceType)
  const durationMs = Date.now() - t0
  if (result.success) {
    const atsType = result.atsType ?? "unknown"
    counter("apply_url.backsolve.success", { sourceType: st, atsType })
    histogram("apply_url.backsolve.duration_ms", durationMs, { sourceType: st, atsType })
  } else {
    counter("apply_url.backsolve.failure", { sourceType: st, reason: result.errorReason ?? "unknown" })
    histogram("apply_url.backsolve.duration_ms", durationMs, { sourceType: st, atsType: "none" })
  }
  return result
}

async function resolveApplyUrlToAtsTenantImpl(
  applyUrl: string,
  sourceType?: string,
): Promise<ResolveResult> {
  const base: ResolveResult = { success: false, confidence: 0, sourceUrl: applyUrl, sourceType, hops: 0 }
  let chain: string[] = []
  let finalUrl = applyUrl

  try {
    // 1 + 2. Follow redirects (detecting at each hop), then fall back to HTML.
    const chainRes = await followChain(applyUrl)
    chain = chainRes.urls
    finalUrl = chainRes.finalUrl
    const hops = chain.length

    if (chainRes.errorReason) {
      return { ...base, finalUrl, hops, errorReason: chainRes.errorReason, domainGuess: guessDomain(chain) }
    }

    let detection = chainRes.detection
    let html: string | null = null
    if (!detection) {
      html = await fetchHtml(finalUrl)
      const inHtml = html ? detectAtsInHtml(html) : null
      if (inHtml) detection = { atsType: inHtml.provider, atsIdentifier: inHtml.identifier }
    }

    const companyNameGuess = guessNameFromHtml(html)
    const domainGuess = guessDomain(chain)

    if (!detection?.atsType) {
      return { ...base, finalUrl, hops, errorReason: "no_ats_match", companyNameGuess, domainGuess }
    }

    const atsType = detection.atsType
    const slug = detection.atsIdentifier ?? undefined
    const shared = {
      atsType,
      atsIdentifier: slug,
      sourceUrl: applyUrl,
      finalUrl,
      sourceType,
      companyNameGuess: companyNameGuess ?? slug,
      domainGuess,
      hops,
    }

    // 3. Validate the board has jobs — only for ATSes with a cheap listing API
    //    and a known slug. Others are accepted as detected-but-unvalidated.
    if (slug && VALIDATORS[atsType]) {
      const outcome = await validateBoard(atsType, slug)
      switch (outcome.kind) {
        case "jobs":
          return { ...shared, success: true, confidence: 90, jobCount: outcome.count }
        case "empty":
          // Real board, no live jobs right now — caller should mark retry_later.
          return { ...shared, success: true, confidence: 60, jobCount: 0 }
        case "not_found":
          // The slug is wrong / detection misled us.
          return { ...shared, success: false, confidence: 0, errorReason: "no_ats_match" }
        case "board_error":
          return { ...shared, success: false, confidence: 0, errorReason: "board_error" }
      }
    }

    // Detected but not job-count-validated (e.g. Workday, iCIMS, or no slug).
    return { ...shared, success: true, confidence: 70 }
  } catch (err) {
    if (err instanceof QueueFullError) {
      return { ...base, finalUrl, hops: chain.length, errorReason: "rate_limited", domainGuess: guessDomain(chain) }
    }
    return { ...base, finalUrl, hops: chain.length, errorReason: "fetch_failed", domainGuess: guessDomain(chain) }
  }
}
