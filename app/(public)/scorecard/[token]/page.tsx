import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import Navbar from "@/components/layout/Navbar"
import { getPublicPersonalScorecard } from "@/lib/scorecard/personal-scorecard"
import { cn } from "@/lib/utils"
import type { ScoreHue } from "@/types/h1b-scorecard"

export const revalidate = 86400

const BASE = process.env.NEXT_PUBLIC_APP_URL ?? "https://hireoven.com"
type Props = { params: Promise<{ token: string }> }

const HUE_TEXT: Record<ScoreHue, string> = {
  emerald: "text-emerald-600",
  green: "text-green-600",
  blue: "text-blue-600",
  amber: "text-amber-600",
  orange: "text-orange-600",
  red: "text-red-500",
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const card = await getPublicPersonalScorecard((await params).token)
  if (!card) return { title: "Scorecard not found — Hireoven" }
  const { token } = await params
  const title = `${card.display_name}'s H-1B Sponsorability Scorecard: ${card.grade} (${card.total_score}/100)`
  const ogImage = `${BASE}/api/og/personal-scorecard/${token}`
  return {
    title,
    description: `${card.display_name} scored ${card.grade} on Hireoven's Sponsorability Scorecard. Get yours in 60 seconds.`,
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
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 text-xl font-bold tabular-nums text-slate-900">{score}/25</div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-slate-400" style={{ width: `${(score / 25) * 100}%` }} />
      </div>
    </div>
  )
}

export default async function PublicScorecardPage({ params }: Props) {
  const card = await getPublicPersonalScorecard((await params).token)
  if (!card) notFound()
  const hue = HUE_TEXT[card.bucket.hue]

  return (
    <div className="min-h-dvh bg-[#F8FAFC] text-slate-950">
      <Navbar />
      <main className="mx-auto max-w-2xl px-4 py-10">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
          <p className="text-sm text-slate-500">H-1B Sponsorability Scorecard</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">{card.display_name}</h1>
          <div className="mt-5 flex items-end gap-4">
            <div className={cn("text-7xl font-black leading-none tracking-tight", hue)}>{card.grade}</div>
            <div className="pb-2">
              <div className={cn("text-3xl font-bold", hue)}>
                {card.total_score}
                <span className="text-lg font-semibold text-slate-400">/100</span>
              </div>
              <div className="text-lg font-semibold text-slate-700">{card.bucket.label}</div>
            </div>
          </div>
          {card.rarest_skill && (
            <p className="mt-4 text-sm text-slate-500">
              Standout in-demand skill: <span className="font-medium text-slate-700">{card.rarest_skill}</span>
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
        <div className="mt-6 rounded-2xl border border-slate-200 bg-gradient-to-br from-[#0b2a23] to-[#0a2440] p-6 text-center">
          <p className="text-lg font-semibold text-white">How sponsorable is your profile?</p>
          <p className="mt-1 text-sm text-white/60">
            Get your own scorecard in 60 seconds — sourced from DOL LCA + USCIS public data.
          </p>
          <Link
            href="/dashboard/scorecard"
            className="mt-4 inline-flex rounded-full bg-white px-5 py-2.5 text-sm font-bold text-slate-900 hover:bg-emerald-400 hover:text-white"
          >
            Get your scorecard
          </Link>
        </div>

        <p className="mt-4 text-center text-xs text-slate-400">
          A profile-vs-market fit signal, not a guarantee.{" "}
          <Link href="/h1b-sponsors/leaderboard/methodology#personal-scorecard" className="underline">
            Methodology
          </Link>
        </p>
      </main>
    </div>
  )
}
