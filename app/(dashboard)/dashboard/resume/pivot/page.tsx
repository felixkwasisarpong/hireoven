import { redirect } from "next/navigation"

export const dynamic = "force-dynamic"

// Career pivot is now a panel inside the review. The feed links here with
// ?to=<field_key> to preselect a target, so that param is carried through.
export default function ResumePivotRedirect({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>
}) {
  const raw = searchParams?.to
  const to = Array.isArray(raw) ? raw[0] : raw
  const params = new URLSearchParams({ panel: "pivot" })
  if (to) params.set("to", to)
  redirect(`/dashboard/resume/review?${params.toString()}#pivot`)
}
