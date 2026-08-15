import type { Metadata } from "next"
import { Suspense } from "react"
import FindClient from "./FindClient"

export const metadata: Metadata = {
  title: "Find jobs that will sponsor your visa — HireOven",
  description:
    "See which jobs actually sponsor H-1B, checked against real DOL & USCIS petition history, before you apply. Free — no account needed to see your matches.",
}

export const dynamic = "force-dynamic"

// Dedicated ad landing page. Value-first: shows sponsor-checked matches for a
// typed role BEFORE any signup, then converts at peak intent. Point Meta ads here.
export default function FindPage() {
  return (
    <Suspense fallback={null}>
      <FindClient />
    </Suspense>
  )
}
