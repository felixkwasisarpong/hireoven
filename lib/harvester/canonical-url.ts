import type { AtsName } from "@/lib/harvester/adapters"

/**
 * Canonical careers URL for an adapter slug — the inverse of
 * `adapter.detectFromUrl()`. Discovery channels (crt.sh, GitHub seeds, etc.)
 * find an `(atsType, slug)` pair and need to write a stable URL into
 * `companies.careers_url` that the harvester will redetect identically.
 *
 * For Workday the slug is a 3-tuple `tenant:wd:site`; everything else is a
 * single token.
 */
export function canonicalCareersUrl(atsType: AtsName, slug: string): string | null {
  if (!slug) return null
  switch (atsType) {
    case "greenhouse":
      return `https://boards.greenhouse.io/${encodeURIComponent(slug)}`
    case "lever":
      return `https://jobs.lever.co/${encodeURIComponent(slug)}`
    case "ashby":
      return `https://jobs.ashbyhq.com/${encodeURIComponent(slug)}`
    case "smartrecruiters":
      return `https://jobs.smartrecruiters.com/${encodeURIComponent(slug)}`
    case "workable":
      return `https://apply.workable.com/${encodeURIComponent(slug)}/`
    case "workday": {
      const parts = slug.split(":")
      if (parts.length !== 3) return null
      const [tenant, wd, site] = parts
      if (!tenant || !wd || !site) return null
      return `https://${tenant}.${wd}.myworkdayjobs.com/en-US/${encodeURIComponent(site)}`
    }
    case "recruitee":
      return `https://${encodeURIComponent(slug)}.recruitee.com/`
    case "teamtailor":
      return `https://${encodeURIComponent(slug)}.teamtailor.com/`
    case "personio":
      return `https://${encodeURIComponent(slug)}.jobs.personio.com/`
    case "bamboohr":
      return `https://${encodeURIComponent(slug)}.bamboohr.com/careers`
    case "jazzhr":
      return `https://${encodeURIComponent(slug)}.applytojob.com/`
    case "jobvite":
      return `https://jobs.jobvite.com/${encodeURIComponent(slug)}/jobs`
    case "icims":
      // Slug is the full hostname (careers-tenant.icims.com, etc.) — used
      // directly as the careers URL root.
      return `https://${slug}/`
    case "successfactors": {
      // Slug shape: `career{N}.{tld}:{companyId}` (e.g. `career4.com:novartis`).
      const [hostPart, companyId] = slug.split(":")
      if (!hostPart || !companyId) return null
      const m = hostPart.match(/^(career(?:1[0-2]?|[2-9]))\.(com|eu)$/)
      if (!m) return null
      return `https://${m[1]}.successfactors.${m[2]}/career?company=${encodeURIComponent(companyId)}`
    }
    case "taleo": {
      // Slug shape: `{tenant}:{section}` (e.g. `marriott:2`).
      const [tenant, section] = slug.split(":")
      if (!tenant || !section) return null
      return `https://${tenant}.taleo.net/careersection/${encodeURIComponent(section)}/jobsearch.ftl?lang=en`
    }
    case "oraclecloud": {
      // Slug shape: `{pod}:{siteCode}` where pod can contain dots
      // (e.g. `eeho.fa.us2:CX_1`).
      const idx = slug.lastIndexOf(":")
      if (idx <= 0) return null
      const pod = slug.slice(0, idx)
      const site = slug.slice(idx + 1)
      if (!pod || !site) return null
      return `https://${pod}.oraclecloud.com/hcmUI/CandidateExperience/en/sites/${encodeURIComponent(site)}/`
    }
    case "usajobs":
      // Slug shape: USAJOBS Organization filter (typically a department name).
      // Synthesize a URL the adapter's detectFromUrl round-trips on.
      return `https://www.usajobs.gov/Search/Results?d=${encodeURIComponent(slug)}`
    default:
      return null
  }
}
