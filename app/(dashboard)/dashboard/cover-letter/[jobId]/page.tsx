import CoverLetterPageClient from "./CoverLetterPageClient"

export const dynamic = "force-dynamic"

type SearchParams = Record<string, string | string[] | undefined>

function readStringParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null
  return typeof value === "string" ? value : null
}

export default async function CoverLetterPage({
  params,
  searchParams,
}: {
  params: Promise<{ jobId: string }>
  searchParams: Promise<SearchParams>
}) {
  const [{ jobId }, sp] = await Promise.all([params, searchParams])
  const mentionSponsorship = readStringParam(sp.mentionSponsorship) === "true"

  return (
    <CoverLetterPageClient
      jobId={jobId}
      initialMentionSponsorship={mentionSponsorship}
    />
  )
}
