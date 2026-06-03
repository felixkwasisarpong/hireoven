const PUBLIC_PRODUCTION_ORIGIN = "https://hireoven.com"

function isLocalOrigin(url: string): boolean {
  return /\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?/i.test(url)
}

/** Public site origin for emails, redirects and absolute/share links (no
 *  trailing slash). These all end up in a recipient's inbox or browser, so the
 *  value must be the public production origin even when generated in dev — a
 *  localhost URL is unreachable for the recipient and unfetchable by social
 *  preview crawlers. We therefore honor NEXT_PUBLIC_SITE_URL / NEXT_PUBLIC_APP_URL
 *  only when they are NOT localhost, and otherwise fall back to the production
 *  domain. (Set NEXT_PUBLIC_SITE_URL on the server to your real origin.) */
export function getPublicSiteUrl() {
  const v = process.env.NEXT_PUBLIC_SITE_URL?.trim() || process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (v && !isLocalOrigin(v)) return v.replace(/\/$/, "")
  const vercel = process.env.VERCEL_URL
  if (vercel && !isLocalOrigin(vercel)) return `https://${vercel.replace(/^https?:\/\//, "")}`
  return PUBLIC_PRODUCTION_ORIGIN
}

/** Alias kept for share-link call sites (copy/Twitter/LinkedIn) for intent
 *  clarity; identical to getPublicSiteUrl() — both never return localhost. */
export const getShareOrigin = getPublicSiteUrl
