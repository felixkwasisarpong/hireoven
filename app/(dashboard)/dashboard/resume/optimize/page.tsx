import type { Metadata } from "next"
import ResumeOptimizeChat from "@/components/resume/ResumeOptimizeChat"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Optimize your résumé — Hireoven",
  description:
    "Pick the lane your résumé should target, then have it sharpened toward that lane.",
}

/**
 * Where an upload lands.
 *
 * The review page still exists and still hosts the positioning, pivot and skills
 * panels — the finding-level detail is worth keeping for anyone who wants to dig.
 * What changed is the default: a person who has just uploaded gets asked what
 * they are aiming at and gets an optimised résumé, rather than a ranked diagnosis
 * they have to act on themselves.
 */
export default function ResumeOptimizePage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 py-2">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Optimize your résumé</h1>
        <p className="text-[15px] text-slate-500">
          Two questions, then I sharpen it toward what you are actually targeting.
        </p>
      </header>

      <ResumeOptimizeChat />
    </div>
  )
}
