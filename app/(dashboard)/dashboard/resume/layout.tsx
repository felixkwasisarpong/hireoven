import ResumeSubNav from "@/components/resume/ResumeSubNav"
import { ApexMiniPanel } from "@/components/apex/ApexMiniPanel"

export default function ResumeHubLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="resume-tab-shell">
      <ResumeSubNav />
      {children}
      <ApexMiniPanel
        suggestionChips={[
          "Adjust my current preferences",
          "Show jobs worth my time",
          "Give me insights on this job",
        ]}
      />
    </div>
  )
}
