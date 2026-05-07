"use client"

import { Suspense } from "react"
import { useSearchParams } from "next/navigation"
import SetupForm from "@/components/interview/SetupForm"

type InterviewType = "text" | "live" | "coding"
const VALID_TYPES: InterviewType[] = ["text", "live", "coding"]

function SetupPageContent() {
  const params = useSearchParams()
  const rawType = params.get("type")
  const initialType = VALID_TYPES.includes(rawType as InterviewType)
    ? (rawType as InterviewType)
    : undefined
  const initialJobId = params.get("jobId") ?? undefined

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      <SetupForm initialType={initialType} initialJobId={initialJobId} />
    </div>
  )
}

export default function SetupPage() {
  return (
    <Suspense>
      <SetupPageContent />
    </Suspense>
  )
}
