const TRANSIENT_QUERY_PARAM_RE =
  /^(utm_|gclid|fbclid|source|share|ref|referral|trk|gh_src)/i

const EXTERNAL_ID_QUERY_KEYS = [
  "gh_jid",
  "jobid",
  "job_id",
  "job-id",
  "reqid",
  "req_id",
  "req-id",
  "opening_id",
  "opening-id",
  "posting_id",
  "posting-id",
  "listing_id",
  "listing-id",
] as const

function cleanValue(value: string | null | undefined, max = 1400): string | null {
  if (!value?.trim()) return null
  return value.trim().slice(0, max)
}

function cleanExternalId(value: string | null | undefined): string | null {
  const v = cleanValue(value, 220)
  if (!v) return null
  // Guard against obviously non-id blobs.
  if (v.length > 220) return null
  if (/[\s<>]/.test(v)) return null
  return v
}

export function normalizeExtensionJobUrl(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null
  try {
    const parsed = new URL(raw.trim())
    parsed.hash = ""

    // Keep LinkedIn normalization in lockstep with /save.
    if (
      (parsed.hostname === "www.linkedin.com" || parsed.hostname === "linkedin.com") &&
      /^\/jobs\//.test(parsed.pathname)
    ) {
      const fromPath = parsed.pathname.match(/^\/jobs\/view\/(\d+)/)?.[1]
      const fromQuery = parsed.searchParams.get("currentJobId")
      const jobId = fromPath ?? fromQuery
      if (jobId && /^\d+$/.test(jobId)) {
        return `https://www.linkedin.com/jobs/view/${jobId}/`
      }
    }

    for (const key of [...parsed.searchParams.keys()]) {
      if (TRANSIENT_QUERY_PARAM_RE.test(key)) parsed.searchParams.delete(key)
    }

    parsed.hostname = parsed.hostname.toLowerCase()
    if (parsed.pathname !== "/") {
      parsed.pathname = parsed.pathname.replace(/\/+$/, "")
    }
    return parsed.toString()
  } catch {
    return raw.trim()
  }
}

function addUrlVariants(raw: string | null | undefined, target: Set<string>) {
  const cleaned = cleanValue(raw)
  if (!cleaned) return

  target.add(cleaned)
  const normalized = normalizeExtensionJobUrl(cleaned)
  if (normalized) target.add(normalized)

  let parsed: URL
  try {
    parsed = new URL(cleaned)
  } catch {
    return
  }

  const ghJid = cleanExternalId(parsed.searchParams.get("gh_jid"))
  if (!ghJid) return

  // Custom-hosted Greenhouse pages often carry noisy extra params. Keep a
  // gh_jid-only variant to align with persisted canonical rows.
  const ghOnly = new URL(parsed.toString())
  ghOnly.hash = ""
  for (const key of [...ghOnly.searchParams.keys()]) {
    if (key.toLowerCase() !== "gh_jid") ghOnly.searchParams.delete(key)
  }
  if (ghOnly.pathname !== "/") ghOnly.pathname = ghOnly.pathname.replace(/\/+$/, "")
  target.add(ghOnly.toString())

  // Some custom-hosted pages use /careers/job/ without a path id. Also include
  // a stable /jobs/<id>?gh_jid=<id> shape for matching existing saved rows.
  const slugged = new URL(ghOnly.toString())
  if (!/\/jobs\/\d+$/i.test(slugged.pathname)) {
    slugged.pathname = `${slugged.pathname.replace(/\/+$/, "")}/jobs/${ghJid}`.replace(
      /\/{2,}/g,
      "/",
    )
    target.add(slugged.toString())
  }
}

export function extractExternalJobIdsFromUrl(raw: string | null | undefined): string[] {
  const cleaned = cleanValue(raw)
  if (!cleaned) return []

  let parsed: URL
  try {
    parsed = new URL(cleaned)
  } catch {
    return []
  }

  const ids = new Set<string>()
  for (const key of EXTERNAL_ID_QUERY_KEYS) {
    const value = cleanExternalId(parsed.searchParams.get(key))
    if (value) ids.add(value)
  }

  const host = parsed.hostname.toLowerCase()
  const linkedInId = parsed.pathname.match(/\/jobs\/view\/(\d+)/)?.[1]
  if (linkedInId) ids.add(linkedInId)

  if (host.includes("greenhouse.io")) {
    const greenhousePathId = parsed.pathname.match(/\/jobs\/(\d+)/i)?.[1]
    if (greenhousePathId) ids.add(greenhousePathId)
  }

  return [...ids]
}

export function isPlaceholderJobTitle(value: string | null | undefined): boolean {
  const title = (value ?? "").trim().toLowerCase()
  if (!title) return true
  return (
    title === "unknown role" ||
    title === "no job found" ||
    title === "job opening" ||
    title === "open role"
  )
}

export function buildExtensionJobFingerprint(args: {
  urls: Array<string | null | undefined>
  externalJobId?: string | null
}): {
  candidateUrls: string[]
  externalJobIds: string[]
} {
  const candidates = new Set<string>()
  const externalIds = new Set<string>()

  const explicitExternalId = cleanExternalId(args.externalJobId)
  if (explicitExternalId) externalIds.add(explicitExternalId)

  for (const url of args.urls) {
    addUrlVariants(url, candidates)
    for (const id of extractExternalJobIdsFromUrl(url)) externalIds.add(id)
  }

  return {
    candidateUrls: [...candidates],
    externalJobIds: [...externalIds],
  }
}
