import { permanentRedirect } from "next/navigation"

// D4: skill gaps now lives as a tab in the Resume hub.
export default function SkillGapRedirect() {
  permanentRedirect("/dashboard/resume/skills")
}
