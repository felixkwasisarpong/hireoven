"use client"

import { useMemo, useState } from "react"
import { cn } from "@/lib/utils"
import {
  companyLogoUrlFromDomain,
  normalizeCompanyDomain,
} from "@/lib/companies/logo-url"

function buildLogoSources(logoUrl: string | null | undefined, domain: string | null | undefined) {
  const out: string[] = []
  const push = (u: string) => {
    const t = u.trim()
    if (t && !out.includes(t)) out.push(t)
  }
  if (logoUrl) push(logoUrl)
  const d = domain ? normalizeCompanyDomain(domain) : ""
  if (d) {
    // Google favicon service is the most reliable hotlink target; then Unavatar, then Clearbit.
    push(companyLogoUrlFromDomain(d, "google-favicon"))
    push(companyLogoUrlFromDomain(d, "unavatar"))
    push(companyLogoUrlFromDomain(d, "clearbit"))
  }
  return out
}

type CompanyLogoProps = {
  companyName: string
  domain?: string | null
  logoUrl?: string | null
  className?: string
}

/**
 * Renders a company mark with automatic fallback when the stored URL fails (e.g. Clearbit 404).
 */
export default function CompanyLogo({
  companyName,
  domain,
  logoUrl,
  className,
}: CompanyLogoProps) {
  const sources = useMemo(() => buildLogoSources(logoUrl, domain), [logoUrl, domain])
  const [index, setIndex] = useState(0)

  const initial = companyName.charAt(0).toUpperCase() || "?"

  if (sources.length === 0 || index >= sources.length) {
    return (
      <div
        className={cn(
          "flex flex-shrink-0 items-center justify-center rounded-md border border-border bg-surface-alt text-sm font-semibold text-brand-navy",
          className
        )}
        aria-hidden
      >
        {initial}
      </div>
    )
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={sources[index]}
      alt={companyName}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      className={cn("flex-shrink-0 rounded-md border border-border object-cover", className)}
      onError={() => setIndex((i) => i + 1)}
    />
  )
}
