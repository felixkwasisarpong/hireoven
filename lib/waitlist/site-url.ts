/** Public site origin for emails and absolute links (no trailing slash). */
export function getPublicSiteUrl() {
  const v = process.env.NEXT_PUBLIC_SITE_URL?.trim()
  if (v) return v.replace(/\/$/, "")
  const vercel = process.env.VERCEL_URL
  if (vercel) return `https://${vercel.replace(/^https?:\/\//, "")}`
  return "http://localhost:3000"
}
