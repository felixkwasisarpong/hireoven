"use client"

import { useParams } from "next/navigation"
import LiveInterviewRoom from "@/components/interview/LiveInterviewRoom"

export default function LiveInterviewPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  return (
    <div className="flex h-full flex-col" style={{ height: "100dvh" }}>
      <LiveInterviewRoom sessionId={sessionId} />
    </div>
  )
}
