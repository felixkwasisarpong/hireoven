"use client"

import { useParams } from "next/navigation"
import LiveCodingWorkspace from "@/components/interview/LiveCodingWorkspace"

export default function CodingInterviewPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  return (
    <div className="flex h-full flex-col" style={{ height: "100dvh" }}>
      <LiveCodingWorkspace sessionId={sessionId} />
    </div>
  )
}
