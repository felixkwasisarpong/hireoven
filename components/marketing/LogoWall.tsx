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
            logoUrl={company.logo_url}
            className="h-12 w-12 grayscale transition group-hover:grayscale-0"
          />
          <span className="line-clamp-1 text-center text-[11px] font-medium text-gray-400 group-hover:text-gray-600">
            {company.name}
          </span>
        </div>
      ))}
    </div>
  )
}
