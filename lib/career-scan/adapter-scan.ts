/**
 * Scan a detected ATS board using the harvester's own adapter.
 *
 * The Career Site Scout scanned every board with `crawlCareersPage`, which is a
 * generic HTML/JSON-LD scraper — it has no adapter dispatch at all. That works
 * for boards whose listings are server-rendered (Greenhouse, Lever), and finds
 * nothing on the ones that are a JavaScript app over a JSON API. Oracle Cloud
 * HCM is the clearest case: the Candidate Experience page ships an empty React
 * shell, so the crawler returned `empty_job_list` for a board that has 409 live
 * jobs behind `recruitingCEJobRequisitions`.
 *
 * The harvester already knows how to read every one of these — that is what the
 * adapters are. So when an adapter claims the URL, use it, and fall back to the
 * generic crawler only for boards no adapter recognises.
 */
import { detectAdapter } from "@/lib/harvester/adapters"
import type { HarvestedJob } from "@/lib/harvester/adapters/_base"
import type { RawJob } from "@/lib/crawler"

export type AdapterScan = {
  /** Adapter that claimed the URL, e.g. "oraclecloud". */
  atsType: string
  /** Board coordinate the harvester will use later, e.g. `ebxr.fa.us2:CX_1`. */
  slug: string
  jobs: RawJob[]
}

/**
 * HarvestedJob and RawJob describe the same thing with one field renamed, so the
 * rest of the scout — region filter, scoring, persistence — is untouched.
 */
export function harvestedToRawJobs(jobs: HarvestedJob[]): RawJob[] {
  return jobs.map((job) => ({
    externalId: job.externalId,
    title: job.title,
    url: job.applyUrl,
    description: job.description,
    location: job.location,
    postedAt: job.postedAt,
    workMode: job.workMode,
    employmentType: job.employmentType,
    salaryMin: job.salaryMin,
    salaryMax: job.salaryMax,
    salaryCurrency: job.salaryCurrency,
  }))
}

/**
 * Returns null when no adapter recognises the URL, which is the caller's signal
 * to fall back to the generic crawler. Throwing is reserved for an adapter that
 * claimed the board and then failed to read it.
 */
export async function scanBoardWithAdapter(
  url: string,
  opts: { timeoutMs?: number } = {},
): Promise<AdapterScan | null> {
  const detected = detectAdapter(url)
  if (!detected) return null

  const result = await detected.adapter.fetchJobs({
    slug: detected.slug,
    ctx: { etag: null, lastModified: null, timeoutMs: opts.timeoutMs ?? 20_000 },
  })

  return {
    atsType: detected.adapter.name,
    slug: detected.slug,
    jobs: harvestedToRawJobs(result.jobs),
  }
}
