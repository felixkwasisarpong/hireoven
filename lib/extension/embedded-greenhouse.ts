import {
  buildExtensionJobFingerprint,
  extractExternalJobIdsFromUrl,
  normalizeExtensionJobUrl,
} from "@/lib/extension/job-fingerprint"

export interface EmbeddedGreenhouseJobDetails {
  externalJobId: string
  title?: string
  company?: string
  location?: string
  descriptionText?: string
  applyUrl?: string
}

function safeUrl(raw: string | null | undefined): URL | null {
  if (!raw?.trim()) return null
  try {
    return new URL(raw.trim())
  } catch {
    return null
  }
}

function pickFirstNonEmpty(...values: Array<string | null | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim()
    if (trimmed) return trimmed
  }
  return undefined
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
}

async function fetchTextWithTimeout(url: string, timeoutMs: number): Promise<string | null> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: "text/html,application/json;q=0.9,*/*;q=0.8",
        "user-agent": "HireovenExtensionResolver/1.0",
      },
      cache: "no-store",
      redirect: "follow",
    })
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

async function fetchJsonWithTimeout<T>(url: string, timeoutMs: number): Promise<T | null> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: "application/json,text/plain,*/*",
        "user-agent": "HireovenExtensionResolver/1.0",
      },
      cache: "no-store",
      redirect: "follow",
    })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

function inferGreenhouseBoardTokenFromUrl(rawUrls: string[]): string | null {
  for (const raw of rawUrls) {
    const parsed = safeUrl(raw)
    if (!parsed) continue
    const host = parsed.hostname.toLowerCase()
    if (!(host.includes("greenhouse.io") || host.includes("job-boards.greenhouse.io"))) continue
    const m = parsed.pathname.match(/^\/([^/]+)\/jobs\/\d+/i)
    if (m?.[1]) return m[1].toLowerCase()
  }
  return null
}

async function inferGreenhouseBoardTokenFromHtml(rawUrls: string[]): Promise<string | null> {
  for (const raw of rawUrls) {
    const parsed = safeUrl(raw)
    if (!parsed) continue
    if (!parsed.searchParams.has("gh_jid")) continue

    const html = await fetchTextWithTimeout(parsed.toString(), 2500)
    if (!html) continue

    const match =
      html.match(/boards\.greenhouse\.io\/embed\/job_board\/js\?for=([a-z0-9][a-z0-9._-]*)/i) ??
      html.match(/embed\/job_board\/js\?for=([a-z0-9][a-z0-9._-]*)/i)
    const token = match?.[1]?.trim().toLowerCase()
    if (token) return token
  }
  return null
}

function looksLikeSofiHost(rawUrls: string[]): URL[] {
  const out: URL[] = []
  for (const raw of rawUrls) {
    const parsed = safeUrl(raw)
    if (!parsed) continue
    if (parsed.hostname.toLowerCase().endsWith("sofi.com")) out.push(parsed)
  }
  return out
}

function cleanDescription(value: string | null | undefined): string | undefined {
  if (!value) return undefined
  const decoded = decodeHtmlEntities(value)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  if (!decoded) return undefined
  return decoded.slice(0, 12000)
}

export async function fetchEmbeddedGreenhouseJobDetails(args: {
  urls: Array<string | null | undefined>
  externalJobId?: string | null
}): Promise<EmbeddedGreenhouseJobDetails | null> {
  const rawUrls = args.urls.map((u) => u?.trim()).filter((u): u is string => Boolean(u))
  if (rawUrls.length === 0 && !args.externalJobId) return null

  const fingerprint = buildExtensionJobFingerprint({
    urls: rawUrls,
    externalJobId: args.externalJobId ?? null,
  })
  const primaryId =
    fingerprint.externalJobIds.find((id) => /^\d{5,}$/.test(id)) ??
    fingerprint.externalJobIds[0] ??
    extractExternalJobIdsFromUrl(rawUrls[0])[0] ??
    null

  if (!primaryId) return null

  // 1) SoFi-specific fast path for embedded Greenhouse pages.
  const sofiUrls = looksLikeSofiHost(rawUrls)
  for (const sofiUrl of sofiUrls) {
    const payload = await fetchJsonWithTimeout<{
      title?: string
      primary_location?: string
      content?: string
      apply_url?: string
      url?: string
      department?: string
    }>(
      `${sofiUrl.origin}/wp-json/api/careers/${encodeURIComponent(primaryId)}/job/`,
      2500,
    )
    if (payload?.title?.trim()) {
      return {
        externalJobId: primaryId,
        title: payload.title.trim(),
        company: "SoFi",
        location: pickFirstNonEmpty(payload.primary_location),
        descriptionText: cleanDescription(payload.content),
        applyUrl:
          normalizeExtensionJobUrl(payload.apply_url ?? payload.url ?? null) ??
          normalizeExtensionJobUrl(sofiUrl.toString()) ??
          undefined,
      }
    }
  }

  // 2) Generic Greenhouse fallback by board token + job id.
  let boardToken = inferGreenhouseBoardTokenFromUrl(rawUrls)
  if (!boardToken) boardToken = await inferGreenhouseBoardTokenFromHtml(rawUrls)
  if (!boardToken) return null

  const greenhouse = await fetchJsonWithTimeout<{
    title?: string
    absolute_url?: string
    content?: string
    location?: { name?: string }
  }>(
    `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(
      boardToken,
    )}/jobs/${encodeURIComponent(primaryId)}?content=true`,
    3000,
  )
  if (!greenhouse?.title?.trim()) return null

  return {
    externalJobId: primaryId,
    title: greenhouse.title.trim(),
    company: undefined,
    location: greenhouse.location?.name?.trim() || undefined,
    descriptionText: cleanDescription(greenhouse.content),
    applyUrl: normalizeExtensionJobUrl(greenhouse.absolute_url ?? null) ?? undefined,
  }
}
