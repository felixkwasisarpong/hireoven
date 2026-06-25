import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { getSessionUser } from "@/lib/auth/session-user"
import { getOrComputePersonalScorecard } from "@/lib/scorecard/personal-scorecard"
import { PersonalScorecardHero } from "@/components/scorecard/PersonalScorecardHero"
import { PersonalScorecardBreakdown } from "@/components/scorecard/PersonalScorecardBreakdown"
import { ShareControls } from "@/components/scorecard/ShareControls"
import { EmbedCodeGenerator } from "@/components/embed/EmbedCodeGenerator"
import { ResumeRequiredEmptyState } from "@/components/scorecard/ResumeRequiredEmptyState"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Your sponsorability scorecard — Hireoven",
}

export default async function MyScorecardPage() {
  const user = await getSessionUser()
  if (!user) redirect("/login?next=/dashboard/scorecard")

  const card = await getOrComputePersonalScorecard(user.sub)

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      {card ? (
        <>
          <PersonalScorecardHero card={card} />
          <PersonalScorecardBreakdown card={card} />
          <ShareControls card={card} />
          {card.is_public && card.share_token && (
            <EmbedCodeGenerator shareToken={card.share_token} />
          )}
        </>
      ) : (
        <ResumeRequiredEmptyState />
      )}
    </main>
  )
}
