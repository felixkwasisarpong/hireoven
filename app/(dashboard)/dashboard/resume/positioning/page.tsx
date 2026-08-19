import { redirect } from "next/navigation"

export const dynamic = "force-dynamic"

// Positioning is now a panel inside the review, so the finding that raises it
// no longer sends the user away from the diagnosis. Kept as a redirect so
// existing links and bookmarks still land in the right place.
export default function ResumePositioningRedirect() {
  redirect("/dashboard/resume/review?panel=positioning#positioning")
}
