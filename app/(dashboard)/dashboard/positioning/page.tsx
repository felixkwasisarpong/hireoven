import { permanentRedirect } from "next/navigation"

// D4: positioning now lives as a tab in the Resume hub. Permanent redirect keeps
// old links/bookmarks working.
export default function PositioningRedirect() {
  permanentRedirect("/dashboard/resume/positioning")
}
