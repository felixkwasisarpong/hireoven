import ResumeSubNav from "@/components/resume/ResumeSubNav"

export default function ResumeHubLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="resume-tab-shell">
      <ResumeSubNav />
      {children}
    </div>
  )
}
