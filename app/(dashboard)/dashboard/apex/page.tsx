import type { Metadata } from "next"
import { Suspense } from "react"
import { ApexWorkspaceShell } from "@/components/apex/workspace/ApexWorkspaceShell"

export const metadata: Metadata = {
  title: "Apex · Hireoven",
  description: "Your AI career co-pilot. Apex prepares, applies, and fights for your career.",
}

export default function ApexPage() {
  return (
    <Suspense>
      <ApexWorkspaceShell />
    </Suspense>
  )
}
