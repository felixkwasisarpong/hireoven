import type { Metadata } from "next"
import ResumeReviewView from "@/components/resume/ResumeReviewView"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Resume review — Hireoven",
  description:
    "A ranked diagnosis of what is actually costing you interviews, read from your own resume.",
}

export default function ResumeReviewPage() {
  return <ResumeReviewView />
}
