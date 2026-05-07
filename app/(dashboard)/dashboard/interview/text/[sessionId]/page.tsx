"use client"

import { useParams } from "next/navigation"
import TextInterviewChat from "@/components/interview/TextInterviewChat"

export default function TextInterviewPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  return (
    <div className="flex h-full flex-col" style={{ height: "calc(100dvh - 57px)" }}>
      <TextInterviewChat sessionId={sessionId} />
    </div>
  )
}
