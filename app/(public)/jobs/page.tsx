import { redirect } from "next/navigation"

// /jobs has no index of its own (only /jobs/[id] detail pages) — funnel it to
// the browse hub so the bare path isn't a dead end.
export default function JobsIndex() {
  redirect("/jobs/browse")
}
