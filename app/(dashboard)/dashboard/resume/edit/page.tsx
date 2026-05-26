import { redirect } from "next/navigation"

export const dynamic = "force-dynamic"

export default function ResumeEditRedirect({
  searchParams,
}: {
  searchParams?: { resumeId?: string }
}) {
  const suffix = searchParams?.resumeId
    ? `&resumeId=${encodeURIComponent(searchParams.resumeId)}`
    : ""
  redirect(`/dashboard/resume/studio?mode=preview${suffix}`)
}
