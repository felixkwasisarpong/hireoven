import { Suspense } from "react"
import { ScoutWorkspaceShell } from "@/components/scout/workspace/ScoutWorkspaceShell"

export default function ScoutPage() {
  return (
    <Suspense>
      <ScoutWorkspaceShell />
    </Suspense>
  )
}
