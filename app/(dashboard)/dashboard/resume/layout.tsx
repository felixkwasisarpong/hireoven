import ResumeSubNav from "@/components/resume/ResumeSubNav"
import { ScoutMiniPanel } from "@/components/scout/ScoutMiniPanel"

export default function ResumeHubLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="resume-tab-shell">
      <ResumeSubNav />
      {children}
      <ScoutMiniPanel
        suggestionChips={["What is weak?", "Improve for backend roles"]}
      />
    </div>
  )
}
