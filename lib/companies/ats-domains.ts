export const ATS_DOMAIN_SUFFIXES = [
  "greenhouse.io",
  "lever.co",
  "ashbyhq.com",
  "myworkdayjobs.com",
  "smartrecruiters.com",
  "icims.com",
  "bamboohr.com",
  "jobvite.com",
  "taleo.net",
  "oraclecloud.com",
  "phenompeople.com",
  "breezy.hr",
  "comeet.co",
  "workable.com",
  "recruitee.com",
]

export function normalizeDomain(value: string | null | undefined): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]!
}

export function isAtsDomain(value: string | null | undefined): boolean {
  const domain = normalizeDomain(value)
  if (!domain) return false
  return ATS_DOMAIN_SUFFIXES.some(
    (suffix) => domain === suffix || domain.endsWith(`.${suffix}`)
  )
}

export function domainFromUrlLike(value: string | null | undefined): string | null {
  if (!value?.trim()) return null
  try {
    const raw = value.includes("://") ? value : `https://${value}`
    return normalizeDomain(new URL(raw).hostname) || null
  } catch {
    return null
  }
}

export function isTemporaryCareersUrl(value: string | null | undefined): boolean {
  if (!value?.trim()) return false
  try {
    const url = new URL(value)
    const host = url.hostname.toLowerCase()
    const path = url.pathname.toLowerCase()
    const params = [...url.searchParams.keys()].map((key) => key.toLowerCase())

    return (
      params.some((key) =>
        ["validitytoken", "token", "signature", "expires", "exp", "share"].includes(key)
      ) ||
      (host.includes("greenhouse.io") && path.includes("/embed")) ||
      path.includes("/share/")
    )
  } catch {
    return false
  }
}
