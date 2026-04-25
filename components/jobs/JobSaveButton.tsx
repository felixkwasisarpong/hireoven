"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { Bookmark, BookmarkCheck, Loader2 } from "lucide-react"
import {
  JOB_APPLICATION_SAVED_EVENT,
  fetchJobSavedState,
  saveJobToPipeline,
} from "@/lib/applications/save-job-client"
import { useToast } from "@/components/ui/ToastProvider"
import { cn } from "@/lib/utils"

type Props = {
  jobId: string
  jobTitle: string
  companyName: string
  applyUrl: string
  companyLogoUrl?: string | null
  /** Round icon (hero) or full-width row (sidebar). */
  variant: "icon" | "row"
  className?: string
}

export default function JobSaveButton({
  jobId,
  jobTitle,
  companyName,
  applyUrl,
  companyLogoUrl,
  variant,
  className,
}: Props) {
  const { pushToast } = useToast()
  const [saved, setSaved] = useState(false)
  const [hydrated, setHydrated] = useState(false)
  const [busy, setBusy] = useState(false)

  const refreshSaved = useCallback(async () => {
    try {
      setSaved(await fetchJobSavedState(jobId))
    } catch {
      setSaved(false)
    } finally {
      setHydrated(true)
    }
  }, [jobId])

  useEffect(() => {
    void refreshSaved()
  }, [refreshSaved])

  useEffect(() => {
    function onSync(e: Event) {
      const detail = (e as CustomEvent<{ jobId?: string }>).detail
      if (detail?.jobId === jobId) setSaved(true)
    }
    window.addEventListener(JOB_APPLICATION_SAVED_EVENT, onSync as EventListener)
    return () => window.removeEventListener(JOB_APPLICATION_SAVED_EVENT, onSync as EventListener)
  }, [jobId])

  const save = async () => {
    if (saved || busy) return
    setBusy(true)
    try {
      const result = await saveJobToPipeline({
        jobId,
        jobTitle,
        companyName,
        applyUrl,
        companyLogoUrl,
        source: "hireoven_job_page",
      })

      if (!result.ok) {
        if (result.status === 401) {
          pushToast({
            tone: "info",
            title: "Sign in to save jobs",
            description: result.message,
          })
          return
        }
        pushToast({
          tone: "error",
          title: "Save failed",
          description: result.message,
        })
        return
      }

      setSaved(true)
      window.dispatchEvent(new CustomEvent(JOB_APPLICATION_SAVED_EVENT, { detail: { jobId } }))
      if (!result.alreadySaved) {
        pushToast({
          tone: "success",
          title: "Saved to pipeline",
          description: "Open Applications to move it through stages.",
        })
      }
    } catch (e) {
      pushToast({
        tone: "error",
        title: "Save failed",
        description: e instanceof Error ? e.message : "Try again in a moment.",
      })
    } finally {
      setBusy(false)
    }
  }

  if (variant === "icon") {
    if (saved) {
      return (
        <Link
          href="/dashboard/applications"
          className={cn(
            "grid h-11 w-11 place-items-center rounded-full border border-emerald-200/90 bg-white text-emerald-700 shadow-md transition hover:bg-emerald-50 sm:h-12 sm:w-12",
            className,
          )}
          aria-label="Saved — view in pipeline"
        >
          <BookmarkCheck className="h-[18px] w-[18px] sm:h-5 sm:w-5" strokeWidth={2.25} />
        </Link>
      )
    }

    return (
      <button
        type="button"
        onClick={() => void save()}
        disabled={busy}
        className={cn(
          "grid h-11 w-11 place-items-center rounded-full border border-stone-200/90 bg-white text-stone-800 shadow-md transition hover:bg-stone-50 disabled:opacity-60 sm:h-12 sm:w-12",
          className,
        )}
        aria-label={busy ? "Saving…" : hydrated ? "Save job to pipeline" : "Save job to pipeline"}
      >
        {!hydrated || busy ? (
          <Loader2 className="h-[18px] w-[18px] animate-spin sm:h-5 sm:w-5" aria-hidden />
        ) : (
          <Bookmark className="h-[18px] w-[18px] sm:h-5 sm:w-5" />
        )}
      </button>
    )
  }

  if (saved) {
    return (
      <Link
        href="/dashboard/applications"
        className={cn(
          "flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50/90 text-sm font-medium text-emerald-900 transition hover:bg-emerald-50",
          className,
        )}
      >
        Saved to pipeline
        <BookmarkCheck className="h-3.5 w-3.5 shrink-0" />
      </Link>
    )
  }

  return (
    <button
      type="button"
      onClick={() => void save()}
      disabled={busy}
      className={cn(
        "flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-stone-200 bg-stone-50/80 text-sm font-medium text-stone-800 transition hover:bg-stone-100 disabled:opacity-60",
        className,
      )}
    >
      {busy ? (
        <>
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
          Saving…
        </>
      ) : !hydrated ? (
        <>
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
          Checking…
        </>
      ) : (
        <>
          Save job
          <Bookmark className="h-3.5 w-3.5 text-stone-500" />
        </>
      )}
    </button>
  )
}
