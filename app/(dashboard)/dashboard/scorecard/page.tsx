import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { getSessionUser } from "@/lib/auth/session-user"
import { getOrComputePersonalScorecard } from "@/lib/scorecard/personal-scorecard"
import { PersonalScorecardHero } from "@/components/scorecard/PersonalScorecardHero"
import { PersonalScorecardBreakdown } from "@/components/scorecard/PersonalScorecardBreakdown"
import { ShareControls } from "@/components/scorecard/ShareControls"
import { ShareEmbedSection } from "@/components/scorecard/ShareEmbedSection"
import { ResumeRequiredEmptyState } from "@/components/scorecard/ResumeRequiredEmptyState"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Your sponsorability scorecard — Hireoven",
}

export default async function MyScorecardPage() {
  const user = await getSessionUser()
  if (!user) redirect("/login?next=/dashboard/scorecard")

  const card = await getOrComputePersonalScorecard(user.sub)
  const year = new Date().getFullYear()

  return (
    <div className="min-h-full bg-[#f4f6f9]">
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        {card ? (
          <>
            <PersonalScorecardHero card={card} />
            <PersonalScorecardBreakdown card={card} />
            {card.is_public && card.share_token ? (
              <ShareEmbedSection card={card} shareToken={card.share_token} hue={card.result.bucket.hue} />
            ) : (
              <div className="mt-6">
                <ShareControls card={card} />
              </div>
            )}
            <footer className="mt-10 text-center text-xs text-slate-400">
              © {year} Hireoven, Inc. All rights reserved.
            </footer>
          </>
        ) : (
          <ResumeRequiredEmptyState />
        )}
      </main>
    </div>
  )
}
