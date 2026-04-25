"use client"

import dynamic from "next/dynamic"
import { ArrowRight } from "lucide-react"
import { useState } from "react"
import { H1BPredictionProvider, useH1BPrediction } from "@/lib/context/H1BPredictionContext"
import { useAuth } from "@/lib/hooks/useAuth"
import { useSubscription } from "@/lib/hooks/useSubscription"
import type { H1BVerdict, H1BPrediction } from "@/types"

const H1BPredictionDrawer = dynamic(() => import("@/components/h1b/H1BPredictionDrawer"), { ssr: false })

const VERDICT_LABEL: Record<H1BVerdict, string> = {
  strong: "Strong",
  good: "Good",
  moderate: "Moderate",
  risky: "Risky",
  unknown: "Unknown",
}

function Inner({
  jobId,
  jobTitle,
  companyName,
  initialPrediction,
}: {
  jobId: string
  jobTitle: string
  companyName: string
  initialPrediction: H1BPrediction | null
}) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const { attachRef, prediction, isLoading } = useH1BPrediction(jobId)
  const combined = prediction ?? initialPrediction

  const signalCopy = combined?.signals?.[0]?.detail ?? combined?.summary ?? null

  return (
    <>
      <section
        ref={attachRef as (node: HTMLElement | null) => void}
        className="relative overflow-hidden rounded-2xl border border-stone-200/70 bg-white/95 p-4 shadow-sm ring-1 ring-stone-100/80 backdrop-blur-sm"
      >
        <h2 className="text-sm font-medium text-stone-800">Visa outlook for this role</h2>

        <p className="mt-1.5 text-xs font-normal leading-relaxed text-stone-500">
          LCA-style estimate from filing patterns and role context—not the same as the employer signal in “At a
          glance.” Not legal advice.
        </p>

        <div className="mt-3 rounded-xl border border-stone-200/60 bg-stone-50/80 p-3">
          <div className="text-[10px] font-medium uppercase tracking-wide text-stone-500">H1B approval</div>

          {isLoading && !combined ? (
            <div className="mt-2 h-8 w-36 animate-pulse rounded-md bg-orange-100/80" />
          ) : combined && combined.isUSJob ? (
            <>
              <div className="mb-2 mt-1.5 flex flex-wrap items-baseline gap-1.5">
                <span className="text-lg font-semibold tracking-tight text-orange-600">
                  {VERDICT_LABEL[combined.verdict]}
                </span>
                {combined.verdict !== "unknown" ? (
                  <span className="text-sm font-medium text-stone-800">~{combined.approvalLikelihood}%</span>
                ) : null}
              </div>
              {signalCopy ? <p className="text-xs leading-relaxed text-stone-600">{signalCopy}</p> : null}
            </>
          ) : (
            <p className="mt-2 text-xs leading-relaxed text-stone-600">
              Outlook is not available for this listing (non-US role or limited employer data).
            </p>
          )}

          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="mt-3 flex h-9 w-full items-center justify-center gap-1.5 rounded-xl border border-stone-200/80 bg-white text-xs font-medium text-orange-700 transition hover:bg-orange-50/60"
          >
            Open full breakdown
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </section>

      {drawerOpen && (
        <H1BPredictionDrawer
          jobId={jobId}
          jobTitle={jobTitle}
          companyName={companyName}
          prediction={combined}
          isLoading={isLoading && !combined}
          onClose={() => setDrawerOpen(false)}
        />
      )}
    </>
  )
}

type Props = {
  jobId: string
  jobTitle: string
  companyName: string
  initialPrediction: H1BPrediction | null
}

export default function JobH1BRoleOutlookCard({
  jobId,
  jobTitle,
  companyName,
  initialPrediction,
}: Props) {
  const { profile } = useAuth()
  const { isProInternational } = useSubscription()
  const enabled = Boolean(profile?.needs_sponsorship || profile?.is_international || isProInternational)
  if (!enabled) return null

  return (
    <H1BPredictionProvider enabled>
      <Inner jobId={jobId} jobTitle={jobTitle} companyName={companyName} initialPrediction={initialPrediction} />
    </H1BPredictionProvider>
  )
}
