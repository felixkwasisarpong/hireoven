/**
 * Resolve a careers page a user pasted to the ATS board behind it.
 *
 * The Scout was built around someone pasting the board itself — a
 * `job-boards.greenhouse.io/...` or Oracle CandidateExperience URL. People do not
 * paste those. They paste `company.com/careers`, and on a sample of ten real
 * careers pages only three resolved: the other seven are JavaScript apps whose
 * board link never appears in the served HTML, so link extraction found nothing.
 * Following the obvious next hop (`careers.zoll.com`, `careers.datadoghq.com`)
 * does not help either — those are JavaScript apps too.
 *
 * What does work is guessing the board coordinate and checking. Every candidate
 * here is confirmed by actually fetching the board: a guess that returns no jobs
 * is discarded, so a wrong guess cannot put another company's roles under this
 * employer's name. That check matters more than it sounds — `cloudflare.com` is
 * recorded in our own companies table as `greenhouse/builtin`, which would have
 * shown BuiltIn's jobs to someone asking about Cloudflare.
 */
import { canonicalCareersUrl } from "@/lib/harvester/canonical-url"
import { generateSlugCandidates } from "@/lib/discovery/slug-candidates"
import { scanBoardWithAdapter, type AdapterScan } from "@/lib/career-scan/adapter-scan"
import type { AtsName } from "@/lib/harvester/adapters"

/** Slug-addressed ATSes, ordered by how often they hit in discovery. */
const PROBE_ATSES: AtsName[] = ["greenhouse", "ashby", "lever", "smartrecruiters", "workable", "bamboohr"]

export type BoardSource = "submitted_url" | "page_link" | "probe" | "known_company"

export type ResolvedBoard = AdapterScan & {
  /** URL actually scanned, for display and for companies.careers_url. */
  url: string
  how: BoardSource
}

/**
 * The distinctive word in a domain — `zoll.com` → `zoll`, `careers.datadoghq.com`
 * → `datadoghq`. Used both to seed slug guesses and to sanity-check identifiers
 * we already hold.
 */
export function brandToken(domain: string | null | undefined): string | null {
  const host = domain?.trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0]
  if (!host) return null
  const labels = host.replace(/^www\./, "").split(".").filter(Boolean)
  if (labels.length === 0) return null
  const meaningful = labels.filter((l) => !/^(careers?|jobs?|talent|apply|recruiting|hire|hiring|www)$/.test(l))
  const first = (meaningful[0] ?? labels[0])!
  return first.replace(/[^a-z0-9]/g, "") || null
}

/**
 * Guesses to try, most specific first. The domain is the stronger signal — it is
 * what the user actually pasted — so it leads; the page-derived company name
 * catches boards whose slug is the brand rather than the domain (`datadoghq.com`
 * is `datadog` on Greenhouse).
 */
export function slugCandidatesFor(domain: string | null, companyName: string | null): string[] {
  const out: string[] = []
  const token = brandToken(domain)
  if (token) out.push(token)
  if (companyName?.trim()) out.push(...generateSlugCandidates(companyName))
  // Deduped, and bounded so a scan cannot fan out into dozens of probes.
  return [...new Set(out.filter((s) => s.length >= 2 && s.length <= 60))].slice(0, 4)
}

/**
 * Does an identifier we already hold plausibly belong to this domain?
 *
 * Records get mis-attached — `cloudflare.com` carries `greenhouse/builtin` — and
 * a stored pair is trusted enough to skip probing, so it needs a check. Requiring
 * the brand token to appear in the identifier (or the reverse, for abbreviations)
 * rejects that pairing while accepting `zoll.com` → `zoll:wd5:ZOLLMedicalCorp`.
 */
export function identifierCorroboratesDomain(
  identifier: string | null | undefined,
  domain: string | null | undefined,
): boolean {
  const token = brandToken(domain)
  const id = identifier?.trim().toLowerCase().replace(/[^a-z0-9]/g, "")
  if (!token || !id) return false
  return id.includes(token) || token.includes(id)
}

/**
 * Bound total wall time, not just each request.
 *
 * `timeoutMs` reaches the adapter as a per-request timeout, which says nothing
 * about how long a board takes overall: an adapter paginates, and AutoZone's
 * Oracle site is 10,000 roles across 50 pages plus detail fetches — 138 seconds,
 * against a route budget of 60. Resolution has to be able to give up.
 */
function withDeadline<T>(work: Promise<T>, ms: number): Promise<T | null> {
  if (ms <= 0) return Promise.resolve(null)
  return Promise.race([
    work,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms).unref?.()),
  ])
}

type ScanAttempt =
  | { kind: "board"; board: ResolvedBoard }
  /** The board exists but did not finish inside the budget. */
  | { kind: "too_slow" }
  | { kind: "miss" }

async function tryScan(
  url: string,
  how: BoardSource,
  timeoutMs: number,
  budgetMs: number,
): Promise<ScanAttempt> {
  try {
    const scan = await withDeadline(
      scanBoardWithAdapter(url, { timeoutMs: Math.min(timeoutMs, budgetMs) }),
      budgetMs,
    )
    if (scan === null) return { kind: "too_slow" }
    // A board that resolves but lists nothing is not a match. Without this a
    // guessed slug that happens to exist as an empty board would win over the
    // real one further down the ladder.
    if (scan.jobs.length === 0) return { kind: "miss" }
    return { kind: "board", board: { ...scan, url, how } }
  } catch {
    return { kind: "miss" }
  }
}

export type ResolveInput = {
  /** URL the user pasted, already normalised. */
  submittedUrl: string
  /** An ATS URL found on the page, if link extraction found one. */
  pageLinkUrl?: string | null
  /** Whether the submitted URL is itself a recognised ATS board. */
  submittedIsAts: boolean
  domain: string | null
  companyName: string | null
  /** ATS pair already recorded for this domain, if any. */
  knownAts?: { atsType: string | null; atsIdentifier: string | null } | null
  timeoutMs?: number
  /** Total wall-clock budget for the whole ladder. */
  budgetMs?: number
}

export type BoardResolution = {
  /** A board confirmed to list jobs. */
  board: ResolvedBoard | null
  /**
   * A board we identified but could not finish reading inside the budget —
   * AutoZone's Oracle site is 10,000 roles and takes over two minutes. Recording
   * the coordinate still enrols the employer, so the harvester fills the roles in
   * shortly rather than the paste appearing to have failed.
   */
  pending: { atsType: string; slug: string; url: string } | null
}

/**
 * Walk the ladder and return the first board that actually lists jobs.
 *
 * Cheap and certain first (the user handed us the board), then the page's own
 * links, then guesses. Probing is last among the automatic paths because it is
 * the only one that costs several network round-trips.
 */
export async function resolveCareerBoard(input: ResolveInput): Promise<BoardResolution> {
  const timeoutMs = input.timeoutMs ?? 20_000
  const startedAt = Date.now()
  const budgetMs = input.budgetMs ?? 35_000
  const remaining = () => budgetMs - (Date.now() - startedAt)

  let pending: BoardResolution["pending"] = null
  const note = (attempt: ScanAttempt, atsType: string, slug: string, url: string) => {
    if (attempt.kind === "too_slow" && !pending) pending = { atsType, slug, url }
  }

  if (input.submittedIsAts) {
    const direct = await tryScan(input.submittedUrl, "submitted_url", timeoutMs, remaining())
    if (direct.kind === "board") return { board: direct.board, pending: null }
  }

  if (input.pageLinkUrl) {
    const viaLink = await tryScan(input.pageLinkUrl, "page_link", timeoutMs, remaining())
    if (viaLink.kind === "board") return { board: viaLink.board, pending: null }
  }

  // A pair we already hold covers the ATSes that cannot be probed by slug alone
  // — Workday needs `tenant:wd5:Site`, Oracle needs a pod and site — but only
  // when it corroborates the domain.
  const known = input.knownAts
  if (
    known?.atsType &&
    known.atsIdentifier &&
    identifierCorroboratesDomain(known.atsIdentifier, input.domain)
  ) {
    const url = canonicalCareersUrl(known.atsType as AtsName, known.atsIdentifier)
    if (url) {
      const viaKnown = await tryScan(url, "known_company", timeoutMs, remaining())
      if (viaKnown.kind === "board") return { board: viaKnown.board, pending: null }
      note(viaKnown, known.atsType, known.atsIdentifier, url)
    }
  }

  const slugs = slugCandidatesFor(input.domain, input.companyName)
  for (const slug of slugs) {
    if (remaining() <= 0) break
    // Probe the ATSes in parallel for one slug: a company is on exactly one, so
    // the first hit ends the round, and a slug that misses everywhere costs one
    // round-trip rather than six sequential ones.
    const results = await Promise.all(
      PROBE_ATSES.map(async (ats): Promise<[AtsName, string | null, ScanAttempt]> => {
        const url = canonicalCareersUrl(ats, slug)
        if (!url) return [ats, null, { kind: "miss" }]
        return [ats, url, await tryScan(url, "probe", Math.min(timeoutMs, 8_000), Math.min(remaining(), 10_000))]
      }),
    )
    const hit = results.find(([, , a]) => a.kind === "board")
    if (hit && hit[2].kind === "board") return { board: hit[2].board, pending: null }
    for (const [ats, url, attempt] of results) {
      if (url) note(attempt, ats, slug, url)
    }
  }

  return { board: null, pending }
}
