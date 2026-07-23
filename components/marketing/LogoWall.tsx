"use client"

import CompanyLogo from "@/components/ui/CompanyLogo"

export type LogoWallCompany = {
  id: string
  name: string
  domain: string | null
  logo_url: string | null
}

type Props = {
  companies: LogoWallCompany[]
}

function isGoogleFaviconUrl(logoUrl: string | null): boolean {
  if (!logoUrl?.trim()) return false
  try {
    const parsed = new URL(logoUrl)
    const host = parsed.hostname.toLowerCase()
    return host.includes("google.com") || host.endsWith(".gstatic.com")
  } catch {
    return false
  }
}

// Simple, server-data-driven logo wall for the marketing page. Renders the
// company mark through our existing <CompanyLogo> which already has a
// multi-provider fallback chain (stored url -> google favicon -> unavatar
// -> clearbit -> initial), so missing or broken URLs degrade gracefully to
// a branded monogram chip instead of a hard 404.
export default function LogoWall({ companies }: Props) {
  if (companies.length === 0) return null

  return (
    <div className="grid grid-cols-3 gap-x-6 gap-y-8 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
      {companies.map((company) => (
        <div
          key={company.id}
          className="group flex flex-col items-center gap-2"
          title={company.name}
        >
          <CompanyLogo
            companyName={company.name}
            domain={company.domain}
            // Marketing wall should avoid tiny Google favicon marks and prefer
            // brand-logo resolution by company domain.
            logoUrl={isGoogleFaviconUrl(company.logo_url) ? null : company.logo_url}
            className="h-12 w-12 transition"
          />
          <span className="line-clamp-1 text-center text-[11px] font-medium text-[#ccd6cf]/45 group-hover:text-[#38e08a]">
            {company.name}
          </span>
        </div>
      ))}
    </div>
  )
}
