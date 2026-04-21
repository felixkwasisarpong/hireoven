"use client"

import Image from "next/image"
import { useMemo, useState } from "react"
import { cn } from "@/lib/utils"
import {
  companyLogoUrlFromDomain,
  normalizeCompanyDomain,
} from "@/lib/companies/logo-url"

const PLACEHOLDER_DOMAIN_RE = /\.(uscis-employer|lca-employer)$/i
const MIN_CRISP_ICON_SIZE = 24

function isPlaceholderDomain(value: string | null | undefined) {
  const normalized = normalizeCompanyDomain(value ?? "")
  return PLACEHOLDER_DOMAIN_RE.test(normalized)
}

function domainFromLogoUrl(logoUrl: string | null | undefined) {
  if (!logoUrl) return ""
  try {
    const url = new URL(logoUrl)
    const host = url.hostname.toLowerCase()

    if (host.includes("google.com")) {
      const domain =
        url.searchParams.get("domain") ??
        url.searchParams.get("domain_url") ??
        ""
      return normalizeCompanyDomain(domain)
    }

    if (host === "logo.clearbit.com" || host === "unavatar.io") {
      return normalizeCompanyDomain(url.pathname.replace(/^\/+/, ""))
    }

    if (host === "icons.duckduckgo.com") {
      const raw = url.pathname.replace(/^\/+/, "")
      const match = raw.match(/^ip3\/(.+)\.ico$/i)
      if (match?.[1]) return normalizeCompanyDomain(match[1])
    }

    return normalizeCompanyDomain(host)
  } catch {
    return ""
  }
}

function isGoogleFaviconUrl(logoUrl: string | null | undefined) {
  if (!logoUrl) return false
  try {
    return new URL(logoUrl).hostname.toLowerCase().includes("google.com")
  } catch {
    return false
  }
}

function buildLogoSources(logoUrl: string | null | undefined, domain: string | null | undefined) {
  const out: string[] = []
  const push = (u: string) => {
    const t = u.trim()
    if (t && !out.includes(t)) out.push(t)
  }

  const explicitDomain = domain ? normalizeCompanyDomain(domain) : ""
  const logoDomain = domainFromLogoUrl(logoUrl)

  const canonicalDomain = [logoDomain, explicitDomain].find(
    (item) => item && !isPlaceholderDomain(item)
  )

  const googleFaviconOnly = isGoogleFaviconUrl(logoUrl)
  if (logoUrl && !googleFaviconOnly) push(logoUrl)

  if (canonicalDomain) {
    push(companyLogoUrlFromDomain(canonicalDomain, "clearbit"))
    push(companyLogoUrlFromDomain(canonicalDomain, "unavatar"))
    push(companyLogoUrlFromDomain(canonicalDomain, "duckduckgo"))
    push(companyLogoUrlFromDomain(canonicalDomain, "google-favicon"))
  }

  if (logoUrl) push(logoUrl)

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
          className="object-contain bg-white p-1"
          referrerPolicy="no-referrer"
          onLoad={(event) => {
            const image = event.currentTarget as HTMLImageElement
            if (
              image.naturalWidth > 0 &&
              image.naturalHeight > 0 &&
              (image.naturalWidth < MIN_CRISP_ICON_SIZE ||
                image.naturalHeight < MIN_CRISP_ICON_SIZE)
            ) {
              setIndex((i) => i + 1)
            }
          }}
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
      className={cn(
        "flex-shrink-0 rounded-md border border-border bg-white object-contain p-1",
        className
      )}
      onLoad={(event) => {
        const image = event.currentTarget
        if (
          image.naturalWidth > 0 &&
          image.naturalHeight > 0 &&
          (image.naturalWidth < MIN_CRISP_ICON_SIZE ||
            image.naturalHeight < MIN_CRISP_ICON_SIZE)
        ) {
          setIndex((i) => i + 1)
        }
      }}
      onError={() => setIndex((i) => i + 1)}
    />
  )
}
