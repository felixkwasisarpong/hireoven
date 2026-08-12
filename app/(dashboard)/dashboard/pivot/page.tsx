import type { Metadata } from "next"
import PivotView from "@/components/resume/PivotView"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Career pivot — Hireoven",
}

export default function PivotPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      <PivotView />
    </main>
  )
}
