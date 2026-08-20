"use client"

/**
 * ResumeViewModal — opens a resume document *inside a modal* instead of kicking
 * the user out to a new browser tab. Point `fileUrl` at any endpoint that serves
 * the document inline (e.g. /api/resume/{id}/file for the live resume, or
 * /api/resume/{id}/versions/{versionId}/file for a saved version); an iframe
 * renders it. This is a pure viewer — no editing here.
 */

import { useEffect, useState } from "react"
import { Loader2, X } from "lucide-react"

type Props = {
  fileUrl: string
  title: string
  onClose: () => void
}

export default function ResumeViewModal({ fileUrl, title, onClose }: Props) {
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    // Lock background scroll while the modal is open.
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.removeEventListener("keydown", onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/50 p-4 sm:p-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`View resume: ${title}`}
    >
      <div
        className="flex h-full max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3.5">
          <p className="truncate text-[15px] font-bold text-slate-950">{title}</p>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="relative min-h-0 flex-1 bg-slate-100">
          {!loaded && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-slate-400">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          )}
          <iframe
            src={fileUrl}
            title={`Resume: ${title}`}
            onLoad={() => setLoaded(true)}
            className="absolute inset-0 h-full w-full border-0"
          />
        </div>
      </div>
    </div>
  )
}
