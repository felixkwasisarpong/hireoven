import { headers } from "next/headers"
import { getPublicPersonalScorecard } from "@/lib/scorecard/personal-scorecard"
import { resolveEmbedToken, hashSubject } from "@/lib/embed/tokens"
import { logEmbedImpression } from "@/lib/embed/log"
import { resolveTheme } from "@/lib/embed/themes"
import { PersonalScorecardWidget, UnavailableWidget } from "@/components/embed/PersonalScorecardWidget"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const BASE = process.env.NEXT_PUBLIC_APP_URL ?? "https://hireoven.com"

type SearchParams = Record<string, string | undefined>

export default async function PersonalScorecardEmbed({
  params,
  searchParams,
}: {
  params: Promise<{ share_token: string }>
  searchParams: SearchParams
}) {
  const { share_token } = await params
  const theme = resolveTheme(searchParams.theme)
  const token = await resolveEmbedToken(searchParams.token)
  const showAttribution = token ? token.showAttribution : true

  const data = await getPublicPersonalScorecard(share_token)

  const h = headers()
  logEmbedImpression({
    widgetType: "personal",
    subjectId: hashSubject(share_token),
    referer: h.get("referer"),
    userAgent: h.get("user-agent"),
    embedTokenId: token?.id ?? null,
  })

  // Revoked / never-shared scorecards render an "unavailable" card, not a 404 — so a
  // partner page that already embedded the iframe degrades gracefully.
  if (!data) return <UnavailableWidget theme={theme} baseUrl={BASE} />

  return (
    <PersonalScorecardWidget
      data={data}
      theme={theme}
      showAttribution={showAttribution}
      baseUrl={BASE}
      shareToken={share_token}
    />
  )
}
