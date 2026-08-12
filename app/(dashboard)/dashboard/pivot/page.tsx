import { permanentRedirect } from "next/navigation"

// D4: career pivot now lives as a tab in the Resume hub. Preserve the ?to=<field>
// deep-link that the feed's pivot cards rely on.
export default function PivotRedirect({
  searchParams,
}: {
  searchParams: { to?: string }
}) {
  const to = typeof searchParams.to === "string" ? searchParams.to : null
  permanentRedirect(`/dashboard/resume/pivot${to ? `?to=${encodeURIComponent(to)}` : ""}`)
}
