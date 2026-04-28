export type GreenhouseNormalization = {
  boardToken: string | null
  originalUrl: string
  normalizedUrl: string | null
  candidates: string[]
  isEmbedUrl: boolean
  hasValidityToken: boolean
  reason: string
}

function safeUrl(value: string): URL | null {
  try {
    return new URL(value.trim())
  } catch {
    return null
  }
}

function cleanBoardToken(value: string | null | undefined): string | null {
  if (!value) return null
  const cleaned = value.trim().replace(/^@+/, "")
  return /^[a-z0-9][a-z0-9_-]*$/i.test(cleaned) ? cleaned : null
}

export function isGreenhouseHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return host === "greenhouse.io" || host.endsWith(".greenhouse.io")
}

export function isGreenhouseEmbedUrl(rawUrl: string): boolean {
  const url = safeUrl(rawUrl)
  if (!url || !isGreenhouseHost(url.hostname)) return false
  const path = url.pathname.toLowerCase()
  return (
    url.searchParams.has("validityToken") ||
    path.startsWith("/embed") ||
    path.includes("/embed/") ||
    path === "/embed" ||
    (url.searchParams.has("for") && path.includes("job_board"))
  )
}

export function extractGreenhouseBoardToken(rawUrl: string): string | null {
  const url = safeUrl(rawUrl)
  if (!url || !isGreenhouseHost(url.hostname)) return null

  const host = url.hostname.toLowerCase()
  const pathParts = url.pathname.split("/").filter(Boolean)
  const fromQuery = cleanBoardToken(url.searchParams.get("for"))
  if (fromQuery) return fromQuery

  if (host === "boards.greenhouse.io" || host === "job-boards.greenhouse.io") {
    const firstPathPart = cleanBoardToken(pathParts[0])
    if (firstPathPart && firstPathPart !== "embed") return firstPathPart
  }

  if (host.endsWith(".greenhouse.io")) {
    const subdomain = cleanBoardToken(host.split(".")[0])
    if (subdomain && subdomain !== "boards" && subdomain !== "job-boards") {
      return subdomain
    }
  }

  return null
}

export function stableGreenhouseBoardCandidates(boardToken: string): string[] {
  const token = encodeURIComponent(boardToken)
  return [
    `https://boards.greenhouse.io/${token}`,
    `https://job-boards.greenhouse.io/${token}`,
  ]
}

export function normalizeGreenhouseBoardUrl(rawUrl: string): GreenhouseNormalization {
  const url = safeUrl(rawUrl)
  const boardToken = extractGreenhouseBoardToken(rawUrl)
  const hasValidityToken = Boolean(url?.searchParams.has("validityToken"))
  const isEmbedUrl = isGreenhouseEmbedUrl(rawUrl)
  const candidates = boardToken ? stableGreenhouseBoardCandidates(boardToken) : []
  const normalizedUrl = candidates[0] ?? null

  return {
    boardToken,
    originalUrl: rawUrl,
    normalizedUrl,
    candidates,
    isEmbedUrl,
    hasValidityToken,
    reason: !url
      ? "invalid_url"
      : !isGreenhouseHost(url.hostname)
      ? "not_greenhouse"
      : !boardToken
      ? "missing_board_token"
      : hasValidityToken
      ? "validity_token_url"
      : isEmbedUrl
      ? "embed_url"
      : "stable_board_url",
  }
}
