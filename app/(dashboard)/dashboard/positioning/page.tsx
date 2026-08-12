import type { Metadata } from "next"
import ResumeSignalView from "@/components/resume/ResumeSignalView"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Resume positioning — Hireoven",
}

export default function PositioningPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      <ResumeSignalView />
    </main>
  )
}
