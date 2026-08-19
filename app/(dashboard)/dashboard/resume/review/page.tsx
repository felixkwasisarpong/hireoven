import type { Metadata } from "next"
import ResumeReviewView from "@/components/resume/ResumeReviewView"
import ResumeReviewPanels, { type PanelId } from "@/components/resume/ResumeReviewPanels"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Resume review — Hireoven",
  description:
    "A ranked diagnosis of what is actually costing you interviews, read from your own resume.",
}

const PANELS: PanelId[] = ["positioning", "pivot", "skills"]

function parsePanel(value: string | string[] | undefined): PanelId | null {
  const candidate = Array.isArray(value) ? value[0] : value
  return candidate && PANELS.includes(candidate as PanelId) ? (candidate as PanelId) : null
}

export default function ResumeReviewPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>
}) {
  return (
    <>
      <ResumeReviewView />
      <div className="mx-auto w-full max-w-3xl px-4 pb-10 sm:px-6">
        <ResumeReviewPanels initialPanel={parsePanel(searchParams?.panel)} />
      </div>
    </>
  )
}
