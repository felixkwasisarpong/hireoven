import AutofillFillPageClient from "./AutofillFillPageClient"

export const dynamic = "force-dynamic"

export default async function AutofillFillPage({
  params,
}: {
  params: Promise<{ jobId: string }>
}) {
  const { jobId } = await params
  return <AutofillFillPageClient jobId={jobId} />
}
