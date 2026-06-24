import type { Metadata } from "next"
import { notFound } from "next/navigation"
import Navbar from "@/components/layout/Navbar"
import { getCompanyScorecard } from "@/lib/h1b/scorecard-query"
import { companyIdFromParam } from "@/lib/seo/company-seo"
import { ScorecardHero } from "@/components/h1b/scorecard/ScorecardHero"
import { ScorecardStats } from "@/components/h1b/scorecard/ScorecardStats"
import { ScorecardShare } from "@/components/h1b/scorecard/ScorecardShare"
import { ScorecardMethodologyNote } from "@/components/h1b/scorecard/ScorecardMethodologyNote"

export const revalidate = 86400

const BASE = process.env.NEXT_PUBLIC_APP_URL ?? "https://hireoven.com"

type Props = { params: Promise<{ company: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const id = companyIdFromParam((await params).company)
  if (!id) return {}
  const data = await getCompanyScorecard(id)
  if (!data) return {}

  const title = `${data.company.name} H-1B Scorecard: ${data.bucket.grade} (${data.score}/100)`
  const description = `${data.company.name} is a ${data.bucket.label.toLowerCase()}. ${data.metrics.certified_latest_fy.toLocaleString()} H-1B petitions certified in FY${data.metrics.latest_fy}. See the full methodology.`
  const ogImage = `${BASE}/api/og/scorecard/${data.company.id}`

  return {
    title,
    description,
    alternates: { canonical: data.scorecard_url },
    openGraph: {
      title,
      description,
      type: "article",
      url: `${BASE}${data.scorecard_url}`,
      images: [{ url: ogImage, width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImage],
    },
  }
}

export default async function ScorecardPage({ params }: Props) {
  const id = companyIdFromParam((await params).company)
  if (!id) notFound()
  const data = await getCompanyScorecard(id)
  if (!data) notFound()

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: `${data.company.name} H-1B Sponsorability Scorecard`,
    image: `${BASE}/api/og/scorecard/${data.company.id}`,
    about: { "@type": "Organization", name: data.company.name },
    isAccessibleForFree: true,
    publisher: { "@type": "Organization", name: "Hireoven" },
    url: `${BASE}${data.scorecard_url}`,
  }

  return (
    <div className="min-h-dvh bg-[#F8FAFC] text-slate-950">
      <Navbar />
      <script
        type="application/ld+json"
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <ScorecardHero data={data} />
        <ScorecardStats data={data} />
        <ScorecardShare data={data} />
        <ScorecardMethodologyNote />
      </main>
    </div>
  )
}
