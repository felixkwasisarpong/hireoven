"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Zap, AlertCircle, CheckCircle2 } from "lucide-react"
import { Button } from "@/components/ui/button"

type ProfileState = "loading" | "no_profile" | "incomplete" | "ready"

type AutofillButtonProps = {
  jobId: string
  alreadyApplied?: boolean
  size?: "sm" | "default"
  className?: string
}

export function AutofillButton({
  jobId,
  alreadyApplied = false,
  size = "sm",
  className = "",
}: AutofillButtonProps) {
  const [profileState, setProfileState] = useState<ProfileState>("loading")
  const [completionPct, setCompletionPct] = useState(0)
  const [hasApplied, setHasApplied] = useState(alreadyApplied)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const [profileRes, applicationRes] = await Promise.all([
          fetch("/api/autofill/profile"),
          fetch(`/api/applications?jobId=${encodeURIComponent(jobId)}`),
        ])

        if (!cancelled) {
          if (!profileRes.ok) {
            setProfileState("no_profile")
          } else {
            const data = await profileRes.json()
            const pct: number = data.completionPct ?? data.completion ?? 0
            setCompletionPct(pct)
            setProfileState(pct >= 70 ? "ready" : "incomplete")
          }

          if (applicationRes.ok) {
            const applicationData = await applicationRes.json()
            setHasApplied(Boolean(applicationData.hasApplied))
          }
        }
      } catch {
        if (!cancelled) {
          setProfileState("no_profile")
        }
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [jobId])

  if (hasApplied) {
    return (
      <div
        className={`inline-flex items-center gap-1.5 text-xs text-gray-500 font-medium ${className}`}
      >
        <CheckCircle2 className="w-3.5 h-3.5" />
        Applied
      </div>
    )
  }

  if (profileState === "loading") {
    return (
      <Button
        size={size}
        variant="outline"
        disabled
        className={`gap-1.5 opacity-50 ${className}`}
      >
        <Zap className="w-3.5 h-3.5" />
        Auto fill
      </Button>
    )
  }

  if (profileState === "no_profile") {
    return (
      <Button
        size={size}
        variant="outline"
        asChild
        title="Create an autofill profile to fill applications automatically"
        className={`gap-1.5 border-amber-300 text-amber-700 hover:bg-amber-50 ${className}`}
      >
        <Link href="/dashboard/autofill">
          <AlertCircle className="w-3.5 h-3.5" />
          Set up auto fill
        </Link>
      </Button>
    )
  }

  if (profileState === "incomplete") {
    return (
      <Button
        size={size}
        variant="outline"
        asChild
        title={`Profile is ${completionPct}% complete - finish more fields for better coverage`}
        className={`gap-1.5 border-amber-300 text-amber-700 hover:bg-amber-50 ${className}`}
      >
        <Link href={`/dashboard/autofill/fill/${jobId}`}>
          <Zap className="w-3.5 h-3.5" />
          Auto fill ({completionPct}%)
        </Link>
      </Button>
    )
  }

  return (
    <Button
      size={size}
      variant="outline"
      asChild
      className={`gap-1.5 border-[#FFD2B8] text-[#9A3412] hover:border-[#FFB088] hover:bg-[#FFF7F2] ${className}`}
    >
      <Link href={`/dashboard/autofill/fill/${jobId}`}>
        <Zap className="w-3.5 h-3.5" />
        Auto fill
      </Link>
    </Button>
  )
}
