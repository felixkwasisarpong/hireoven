"use client"

import Image from "next/image"
import { useMemo, useState } from "react"
import { cn } from "@/lib/utils"
import {
  companyLogoUrlFromDomain,
  normalizeCompanyDomain,
} from "@/lib/companies/logo-url"
import { isAtsDomain } from "@/lib/companies/ats-domains"

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

    if (host === "icon.horse") {
      const raw = url.pathname.replace(/^\/+/, "")
      const match = raw.match(/^icon\/(.+)$/i)
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
    const host = new URL(logoUrl).hostname.toLowerCase()
    return host.includes("google.com") || host.endsWith(".gstatic.com")
  } catch {
    return false
  }
}

function isClearbitUrl(logoUrl: string | null | undefined) {
  if (!logoUrl) return false
  try {
    return new URL(logoUrl).hostname === "logo.clearbit.com"
  } catch {
    return false
  }
}

function isInvalidPlaceholderGoogleFaviconUrl(logoUrl: string | null | undefined) {
  if (!logoUrl) return false
  try {
    const url = new URL(logoUrl)
    const host = url.hostname.toLowerCase()
    if (!host.includes("google.com") && !host.endsWith(".gstatic.com")) return false
    const faviconDomain =
      url.searchParams.get("domain") ??
      url.searchParams.get("domain_url") ??
      ""
    return isPlaceholderDomain(faviconDomain)
  } catch {
    return false
  }
}

function isInvalidAtsLogoUrl(logoUrl: string | null | undefined) {
  const domain = domainFromLogoUrl(logoUrl)
  return Boolean(domain && isAtsDomain(domain))
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
    (item) => item && !isPlaceholderDomain(item) && !isAtsDomain(item)
  )

  const googleFaviconOnly = isGoogleFaviconUrl(logoUrl)
  const invalidPlaceholderFavicon = isInvalidPlaceholderGoogleFaviconUrl(logoUrl)
  const invalidAtsLogo = isInvalidAtsLogoUrl(logoUrl)
  const isStaticAsset = !!logoUrl?.trim().startsWith("/")
  const isClearbit = isClearbitUrl(logoUrl)

  // Static assets and curated marks come first.
  if (logoUrl && !invalidPlaceholderFavicon && !invalidAtsLogo && isStaticAsset) push(logoUrl)

  // Clearbit brand marks are high quality — try before the generic favicon fallback.
  if (logoUrl && !invalidPlaceholderFavicon && !invalidAtsLogo && isClearbit) push(logoUrl)

  // Google favicon stored directly: push it before synthesising another.
  if (logoUrl && !invalidPlaceholderFavicon && !invalidAtsLogo && googleFaviconOnly) push(logoUrl)

  if (canonicalDomain) {
    // Try brand/logo providers before generic favicon so we avoid initials.
    push(companyLogoUrlFromDomain(canonicalDomain, "logo-dev"))
    push(companyLogoUrlFromDomain(canonicalDomain, "clearbit"))
    push(companyLogoUrlFromDomain(canonicalDomain, "unavatar"))
    push(companyLogoUrlFromDomain(canonicalDomain, "icon-horse"))
    push(companyLogoUrlFromDomain(canonicalDomain, "duckduckgo"))
    push(companyLogoUrlFromDomain(canonicalDomain, "google-favicon"))
  }

  if (
    logoUrl &&
    !invalidPlaceholderFavicon &&
    !invalidAtsLogo &&
    !isStaticAsset &&
    !googleFaviconOnly &&
    !isClearbit
  ) {
    // Other legacy providers (unavatar, icon-horse, duckduckgo) as last resort.
    push(logoUrl)
  }

  return out
}

/** Hostnames allowed by next.config images.remotePatterns - proxy via /_next/image so the browser does not hit Cloudflare directly (avoids noisy __cf_bm cookie warnings). */
function shouldOptimizeWithNextImage(src: string): boolean {
  try {
    const { hostname } = new URL(src)
    if (hostname === "icon.horse") return true
    if (hostname === "img.logo.dev") return true
    if (hostname === "logo.clearbit.com") return true
    if (hostname === "unavatar.io") return true
    if (hostname === "www.google.com" || hostname.endsWith(".gstatic.com")) return true
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
  /** Use eager loading + fetchPriority high; recommended for above-the-fold cards. */
  priority?: boolean
}

/**
 * Renders a company mark with automatic fallback when the stored URL fails (e.g. Clearbit 404).
 *
 * UX: a colored initial-letter chip is rendered immediately as the visible backdrop; the remote
 * image fades in on top once it loads. This keeps cards "filled" instead of flashing empty squares
 * while favicons/Clearbit hits travel the network.
 */
export default function CompanyLogo({
  companyName,
  domain,
  logoUrl,
  className,
  priority = false,
}: CompanyLogoProps) {
  const sources = useMemo(() => buildLogoSources(logoUrl, domain), [logoUrl, domain])
  const [index, setIndex] = useState(0)
  const [loaded, setLoaded] = useState(false)

  const initial = companyName.charAt(0).toUpperCase() || "?"

  const placeholder = (
    <div
      aria-hidden
      className="absolute inset-0 flex items-center justify-center bg-surface-alt text-sm font-semibold text-brand-navy"
    >
      {initial}
    </div>
  )

  const noSource = sources.length === 0 || index >= sources.length

  if (noSource) {
    return (
      <div
        className={cn(
          "relative flex-shrink-0 overflow-hidden rounded-md border border-border",
          className
        )}
      >
        {placeholder}
      </div>
    )
  }

  const src = sources[index]
  const viaNext = shouldOptimizeWithNextImage(src)

  function handleSmallImage(naturalWidth: number, naturalHeight: number) {
    if (
      naturalWidth > 0 &&
      naturalHeight > 0 &&
      (naturalWidth < MIN_CRISP_ICON_SIZE || naturalHeight < MIN_CRISP_ICON_SIZE)
    ) {
      setLoaded(false)
      setIndex((i) => i + 1)
    }
  }

  return (
    <div
      className={cn(
        "relative flex-shrink-0 overflow-hidden rounded-md border border-border",
        className
      )}
    >
      {placeholder}
      {viaNext ? (
        <Image
          key={src}
          src={src}
          alt={companyName}
          fill
          sizes="(max-width: 768px) 48px, 64px"
          priority={priority}
          loading={priority ? "eager" : "lazy"}
          className={cn(
            "object-contain bg-white p-1 transition-opacity duration-200",
            loaded ? "opacity-100" : "opacity-0"
          )}
          referrerPolicy="no-referrer"
          onLoad={(event) => {
            const image = event.currentTarget as HTMLImageElement
            handleSmallImage(image.naturalWidth, image.naturalHeight)
            setLoaded(true)
          }}
          onError={() => {
            setLoaded(false)
            setIndex((i) => i + 1)
          }}
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={src}
          src={src}
          alt={companyName}
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : "auto"}
          decoding="async"
          referrerPolicy="no-referrer"
          className={cn(
            "absolute inset-0 h-full w-full bg-white object-contain p-1 transition-opacity duration-200",
            loaded ? "opacity-100" : "opacity-0"
          )}
          onLoad={(event) => {
            const image = event.currentTarget
            handleSmallImage(image.naturalWidth, image.naturalHeight)
            setLoaded(true)
          }}
          onError={() => {
            setLoaded(false)
            setIndex((i) => i + 1)
          }}
        />
      )}
    </div>
  )
}
