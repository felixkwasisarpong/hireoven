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
        suggestionChips={[
          "Adjust my current preferences",
          "Show jobs worth my time",
          "Give me insights on this job",
        ]}
      />
    </div>
  )
}
