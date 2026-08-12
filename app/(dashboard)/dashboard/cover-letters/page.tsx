import { permanentRedirect } from "next/navigation"

// D4: the cover-letter archive now lives as a tab in the Resume hub. The per-job
// editor stays at /dashboard/cover-letter/[jobId]. Preserve any query (e.g.
// ?highlight=<id>) so deep links keep working.
export default function CoverLettersRedirect({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>
}) {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(searchParams)) {
    if (typeof v === "string") qs.set(k, v)
    else if (Array.isArray(v) && v[0]) qs.set(k, v[0])
  }
  const q = qs.toString()
  permanentRedirect(`/dashboard/resume/cover-letters${q ? `?${q}` : ""}`)
}
