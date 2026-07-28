import { headers } from "next/headers"
import { getPublicPersonalScorecard } from "@/lib/scorecard/personal-scorecard"
import { resolveEmbedToken, resolveAttribution, resolveAccent, hashSubject } from "@/lib/embed/tokens"
import { logEmbedImpression } from "@/lib/embed/log"
import { resolveTheme } from "@/lib/embed/themes"
import { PersonalScorecardWidget, UnavailableWidget } from "@/components/embed/PersonalScorecardWidget"
import { siteBaseUrl } from "@/lib/seo/site-url"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const BASE = siteBaseUrl()

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
  const attrKey = searchParams.attribution_key ?? searchParams.token ?? null
  const token = await resolveEmbedToken(attrKey)
  const showAttribution = resolveAttribution(token, searchParams.attribution)
  const accent = resolveAccent(token, searchParams.accent)

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
      accent={accent}
      showAttribution={showAttribution}
      baseUrl={BASE}
      shareToken={share_token}
      attributionKey={attrKey}
    />
  )
}
