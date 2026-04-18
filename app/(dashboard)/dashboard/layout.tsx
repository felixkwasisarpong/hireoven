import { ResumeProvider } from "@/components/resume/ResumeProvider"

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <ResumeProvider>{children}</ResumeProvider>
}
