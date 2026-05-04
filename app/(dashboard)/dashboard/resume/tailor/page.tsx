import { redirect } from "next/navigation"

export default function ResumeTailorRedirect({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>
}) {
  const next = new URLSearchParams()
  next.set("mode", "tailor")

  const carry = ["resumeId", "jobId", "analysisId", "autoAnalyze"]
  for (const key of carry) {
    const value = searchParams?.[key]
    if (typeof value === "string" && value.trim().length > 0) {
      next.set(key, value)
    }
  }

  redirect(`/dashboard/resume/studio?${next.toString()}`)
}
