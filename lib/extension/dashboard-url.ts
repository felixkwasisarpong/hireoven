const PRODUCTION_HIREOVEN_ORIGIN = "https://hireoven.com"

function isLocalHost(hostname: string): boolean {
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

function safePublicOrigin(rawOrigin: string | null): string | null {
  if (!rawOrigin || !/^https?:\/\//i.test(rawOrigin)) return null
  try {
    const parsed = new URL(rawOrigin)
    if (isLocalHost(parsed.hostname)) return parsed.origin
    if (isHireovenHost(parsed.hostname)) return PRODUCTION_HIREOVEN_ORIGIN
    return null
  } catch {
    return null
  }
}

export function extensionDashboardOrigin(request: Request): string {
  const headerOrigin = safePublicOrigin(request.headers.get("origin"))
  if (headerOrigin) return headerOrigin

  try {
    const requestOrigin = safePublicOrigin(new URL(request.url).origin)
    if (requestOrigin) return requestOrigin
  } catch {
    // Fall through to production.
  }

  return PRODUCTION_HIREOVEN_ORIGIN
}

export function extensionDashboardUrl(request: Request, jobId: string): string {
  return `${extensionDashboardOrigin(request)}/dashboard/jobs/${jobId}`
}
