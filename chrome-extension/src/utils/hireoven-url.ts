const PRODUCTION_HIREOVEN_ORIGIN = "https://hireoven.com"

function isLocalAppHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "127.0.0.1" ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host === "[::1]"
  )
}

function isHireovenHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return host === "hireoven.com" || host.endsWith(".hireoven.com")
}

export function normalizeHireovenDashboardUrl(url: string | null | undefined): string | null {
  if (!url) return null

  try {
    const parsed = new URL(url)
    if (isLocalAppHost(parsed.hostname)) {
      return parsed.toString()
    }
    if (isHireovenHost(parsed.hostname)) {
      return `${PRODUCTION_HIREOVEN_ORIGIN}${parsed.pathname}${parsed.search}${parsed.hash}`
    }
    return parsed.toString()
  } catch {
    return null
  }
}

export function productionHireovenUrl(path: string): string {
  return `${PRODUCTION_HIREOVEN_ORIGIN}${path.startsWith("/") ? path : `/${path}`}`
}
