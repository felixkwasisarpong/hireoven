import { redirect } from "next/navigation"

export const dynamic = "force-dynamic"

// Skill gaps are now a panel inside the review — they were already surfaced
// there as a finding, so the standalone tab duplicated it.
export default function ResumeSkillsRedirect() {
  redirect("/dashboard/resume/review?panel=skills#skills")
}
