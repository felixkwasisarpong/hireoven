import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import Navbar from "@/components/layout/Navbar"
import { getPublicPersonalScorecard } from "@/lib/scorecard/personal-scorecard"
import { siteBaseUrl } from "@/lib/seo/site-url"
import { cn } from "@/lib/utils"
import type { ScoreHue } from "@/types/h1b-scorecard"

export const revalidate = 86400

const BASE = siteBaseUrl()
type Props = { params: Promise<{ token: string }> }

// Semantic grade hues — kept DISTINCT (do not collapse). Brightened for the dark canvas.
const HUE_TEXT: Record<ScoreHue, string> = {
  emerald: "text-emerald-700",
  green: "text-green-700",
  lime: "text-lime-700",
  amber: "text-amber-700",
  orange: "text-orange-700",
  red: "text-red-700",
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const card = await getPublicPersonalScorecard((await params).token)
  if (!card) return { title: "Scorecard not found — Hireoven", robots: { index: false, follow: false } }
  const { token } = await params
  const title = `${card.display_name}'s H-1B Sponsorability Scorecard: ${card.grade} (${card.total_score}/100)`
  const ogImage = `${BASE}/api/og/personal-scorecard/${token}`
  return {
    title,
    description: `${card.display_name} scored ${card.grade} on Hireoven's Sponsorability Scorecard. Get yours in 60 seconds.`,
    alternates: { canonical: `${BASE}/scorecard/${token}` },
    robots: { index: false, follow: true },
    openGraph: {
      title,
      description: "Sponsorability scorecard powered by DOL LCA + USCIS public data.",
      type: "article",
      images: [{ url: ogImage, width: 1200, height: 630 }],
    },
    twitter: { card: "summary_large_image", title, images: [ogImage] },
  }
}

function Stat({ label, score }: { label: string; score: number }) {
  return (
    <div className="term-panel p-4">
      <div className="term-label">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums text-[#38e08a]">{score}/25</div>
      <div className="mt-2 h-1.5 w-full overflow-hidden bg-[#0a0e0c]">
        <div className="h-full bg-[#38e08a]" style={{ width: `${(score / 25) * 100}%` }} />
      </div>
    </div>
  )
}

export default async function PublicScorecardPage({ params }: Props) {
  const card = await getPublicPersonalScorecard((await params).token)
  if (!card) notFound()
  const hue = HUE_TEXT[card.bucket.hue]

  return (
    <div className="term-page min-h-dvh">
      <Navbar />
      <main className="mx-auto max-w-2xl px-4 py-10">
        <div className="term-panel p-6 sm:p-8">
          <p className="term-label">Sponsorability scorecard</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white">{card.display_name}</h1>
          <div className="mt-5 flex items-end gap-4">
            <div className={cn("text-7xl font-semibold leading-none tracking-tight", hue)}>{card.grade}</div>
            <div className="pb-2">
              <div className={cn("text-3xl font-semibold tabular-nums", hue)}>
                {card.total_score}
                <span className="text-lg font-semibold text-[#ccd6cf]/45">/100</span>
              </div>
              <div className={cn("text-lg font-semibold", hue)}>{card.bucket.label}</div>
            </div>
          </div>
          {card.rarest_skill && (
            <p className="mt-4 text-[13px] text-[#ccd6cf]/55">
              Standout in-demand skill: <span className="font-medium text-[#ccd6cf]">{card.rarest_skill}</span>
            </p>
          )}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Skills demand" score={card.components.demand} />
          <Stat label="Skills rarity" score={card.components.rarity} />
          <Stat label="Experience fit" score={card.components.experience} />
          <Stat label="Education" score={card.components.education} />
        </div>

        {/* Conversion CTA */}
        <div className="term-panel mt-6 p-6 text-center">
          <p className="text-lg font-semibold text-white">How sponsorable is your profile?</p>
          <p className="mt-1 text-[13px] text-[#ccd6cf]/60">
            Get your own scorecard in 60 seconds — sourced from DOL LCA + USCIS public data.
          </p>
          <Link href="/signup?next=%2Fdashboard%2Fscorecard" className="term-btn term-btn-amber mt-4">
            Get your scorecard
          </Link>
        </div>

        <p className="mt-4 text-center text-[12px] text-[#ccd6cf]/45">
          A profile-vs-market fit signal, not a guarantee.{" "}
          <Link href="/h1b-sponsors/leaderboard/methodology#personal-scorecard" className="text-[#f5a623] underline decoration-[#c2410c]/40 underline-offset-4 hover:decoration-[#c2410c]">
            Methodology
          </Link>
        </p>
      </main>
    </div>
  )
}
