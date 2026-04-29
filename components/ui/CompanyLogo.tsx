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

    // logo.dev: https://img.logo.dev/{domain}?token=...
    if (host === "img.logo.dev") {
      return normalizeCompanyDomain(url.pathname.replace(/^\/+/, "").split("?")[0] ?? "")
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

function isLogoDevUrl(logoUrl: string | null | undefined) {
  if (!logoUrl) return false
  try {
    return new URL(logoUrl).hostname === "img.logo.dev"
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

  const invalidPlaceholderFavicon = isInvalidPlaceholderGoogleFaviconUrl(logoUrl)
  const invalidAtsLogo = isInvalidAtsLogoUrl(logoUrl)
  const isStaticAsset = !!logoUrl?.trim().startsWith("/")

  // 1. Curated local static assets always come first.
  if (logoUrl && !invalidPlaceholderFavicon && !invalidAtsLogo && isStaticAsset) push(logoUrl)

  if (canonicalDomain) {
    // 2. logo.dev — primary brand-mark provider.
    // companyLogoUrlFromDomain falls back to google-favicon when LOGO_DEV_TOKEN is absent,
    // so the google-favicon push below deduplicates cleanly via the Set check.
    push(companyLogoUrlFromDomain(canonicalDomain, "logo-dev"))
    // 3. Google favicon — always returns something; final network fallback before initials.
    push(companyLogoUrlFromDomain(canonicalDomain, "google-favicon"))
  }

  // 4. Stored URL as last resort — but never Clearbit (being deprecated), ATS domains,
  // or placeholder domains. logo.dev and static assets are already in the list.
  if (
    logoUrl &&
    !invalidPlaceholderFavicon &&
    !invalidAtsLogo &&
    !isStaticAsset &&
    !isClearbitUrl(logoUrl) &&
    !isLogoDevUrl(logoUrl)
  ) {
    push(logoUrl)
  }

  return out
}

/** Hostnames proxied via /_next/image (avoids noisy __cf_bm Cloudflare cookie warnings). */
function shouldOptimizeWithNextImage(src: string): boolean {
  try {
    const { hostname } = new URL(src)
    if (hostname === "img.logo.dev") return true
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
