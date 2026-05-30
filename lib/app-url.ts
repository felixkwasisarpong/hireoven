/**
 * Resolve the public origin (scheme + host, no trailing slash) for building
 * absolute redirect URLs — Stripe success/cancel/return URLs, email links, etc.
 *
 * Why this exists: `NEXT_PUBLIC_*` env vars are inlined at BUILD time by
 * Next.js, including inside server route handlers. So the value baked into the
 * Docker image (from CI) is what runs in production — anything set at runtime
 * in docker-compose is ignored for these references. When that baked value is
 * empty or missing its scheme, `${appUrl}/path` produces a relative URL that
 * Stripe rejects with `url_invalid` (param: success_url).
 *
 * The live request origin is always correct at runtime and immune to build-time
 * inlining, so prefer it. Fall back to a validated env value, then the known
 * production host.
 */
export function resolveAppOrigin(request?: Request): string {
  if (request) {
    const origin = request.headers.get("origin")?.trim()
    if (origin && /^https?:\/\//i.test(origin)) return origin.replace(/\/$/, "")

    const host = request.headers.get("host")?.trim()
    if (host) {
      const proto =
        request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || "https"
      return `${proto}://${host}`.replace(/\/$/, "")
    }
  }

  // `??` alone would let an empty string or scheme-less value through, so
  // validate that we actually have an absolute http(s) origin.
  const env = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "")
  if (env && /^https?:\/\//i.test(env)) return env

  return "https://hireoven.com"
}
