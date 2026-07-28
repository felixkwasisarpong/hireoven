/** Canonical absolute site origin, used by metadata, the sitemap index, and robots.
 *  Public URL envs can be blank in prod and `??` only catches null/undefined, so a
 *  plain fallback let an empty string through — producing relative <loc> values that
 *  Search Console rejects. Require a real http(s) origin; else fall back to the
 *  production domain. No imports here so edge/runtime-light routes can use it safely. */
export function siteBaseUrl(): string {
  const envUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim() || process.env.NEXT_PUBLIC_APP_URL?.trim()
  return envUrl && /^https?:\/\//.test(envUrl) ? envUrl.replace(/\/+$/, "") : "https://hireoven.com"
}
