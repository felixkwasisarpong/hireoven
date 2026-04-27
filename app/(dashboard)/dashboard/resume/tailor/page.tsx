import { redirect } from "next/navigation"

export default function ResumeTailorRedirect({
  searchParams,
}: {
  searchParams?: { resumeId?: string }
}) {
  const suffix = searchParams?.resumeId
    ? `&resumeId=${encodeURIComponent(searchParams.resumeId)}`
    : ""
  redirect(`/dashboard/resume/studio?mode=tailor${suffix}`)
}
