"use client"

import Image from "next/image"
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
    push(companyLogoUrlFromDomain(d, "google-favicon"))
    push(companyLogoUrlFromDomain(d, "unavatar"))
    push(companyLogoUrlFromDomain(d, "clearbit"))
  }
  return out
}

/** Hostnames allowed by next.config images.remotePatterns — proxy via /_next/image so the browser does not hit Cloudflare directly (avoids noisy __cf_bm cookie warnings). */
function shouldOptimizeWithNextImage(src: string): boolean {
  try {
    const { hostname } = new URL(src)
    if (hostname === "logo.clearbit.com") return true
    if (hostname === "unavatar.io") return true
    if (hostname === "www.google.com") return true
    if (hostname.endsWith(".supabase.co") || hostname.endsWith(".supabase.in")) return true
    return false
  } catch {
    return false
  }
}

type CompanyLogoProps = {
  companyName: string
  domain?: string | null
  logoUrl?: string | null
  className?: string
}

/**
 * Renders a company mark with automatic fallback when the stored URL fails (e.g. Clearbit 404).
 * Known CDNs use next/image so loads are same-origin to the app and third-party cookies are not set in the browser.
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

  const src = sources[index]
  const viaNext = shouldOptimizeWithNextImage(src)

  if (viaNext) {
    return (
      <div
        className={cn("relative flex-shrink-0 overflow-hidden rounded-md border border-border", className)}
      >
        <Image
          key={src}
          src={src}
          alt={companyName}
          fill
          sizes="(max-width: 768px) 48px, 64px"
          className="object-cover"
          referrerPolicy="no-referrer"
          onError={() => setIndex((i) => i + 1)}
        />
      </div>
    )
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      key={src}
      src={src}
      alt={companyName}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      className={cn("flex-shrink-0 rounded-md border border-border object-cover", className)}
      onError={() => setIndex((i) => i + 1)}
    />
  )
}
