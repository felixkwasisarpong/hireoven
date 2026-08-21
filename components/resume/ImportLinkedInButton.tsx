"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Linkedin, Loader2, X } from "lucide-react"
import { useToast } from "@/components/ui/ToastProvider"
import { useActiveBrowserContext } from "@/lib/apex/browser-context"
import { cn } from "@/lib/utils"
import type { Resume } from "@/types"

type Phase = "idle" | "importing" | "submitting"

// How long to wait for the extension to open LinkedIn, scrape the profile +
// the full experience/education detail pages, and respond before falling back
// to manual paste. Multi-page scrape needs more headroom than a single page.
const EXTENSION_TIMEOUT_MS = 70_000

type Props = {
  onImported: (resume: Resume) => void
  className?: string
  compact?: boolean
}

export default function ImportLinkedInButton({ onImported, className, compact = false }: Props) {
  const { pushToast } = useToast()
  const { isExtensionConnected, requestSync } = useActiveBrowserContext()
  const router = useRouter()

  const [phase, setPhase] = useState<Phase>("idle")
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState("")
  const [urlText, setUrlText] = useState("")
  const listenerRef = useRef<((e: MessageEvent) => void) | null>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cleanupListener = useCallback(() => {
    if (listenerRef.current) {
      window.removeEventListener("message", listenerRef.current)
      listenerRef.current = null
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }, [])

  useEffect(() => cleanupListener, [cleanupListener])

  const submitRawText = useCallback(
    async (rawText: string) => {
      setPhase("submitting")
      try {
        const res = await fetch("/api/resume/import-linkedin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rawText }),
        })
        const data = (await res.json().catch(() => ({}))) as { resume?: Resume; error?: string }
        if (!res.ok || !data.resume) {
          throw new Error(data.error ?? "Could not import LinkedIn profile.")
        }
        pushToast({
          tone: "success",
          title: "LinkedIn profile imported",
          description: data.resume.primary_role
            ? `Detected role: ${data.resume.primary_role}. Review and refine in the editor.`
            : "Review and refine your imported resume in the editor.",
        })
        setPasteOpen(false)
        setPasteText("")
        onImported(data.resume)
        // Imported profiles get the same treatment as uploads: go straight to
        // the review rather than leaving the record sitting in the library.
        router.push("/dashboard/resume/optimize")
      } catch (error) {
        pushToast({
          tone: "error",
          title: "Import failed",
          description: error instanceof Error ? error.message : "Please try again.",
        })
      } finally {
        setPhase("idle")
      }
    },
    [onImported, pushToast, router]
  )

  // Trigger the extension to open a LinkedIn profile in the user's logged-in
  // session, scrape it, and push the text back. With `url`, it opens that exact
  // profile; without, it falls back to the user's own profile (/in/me/).
  const startExtensionImport = useCallback(
    (url?: string) => {
      cleanupListener()
      setPhase("importing")

      const handler = (event: MessageEvent) => {
        if (typeof event.data !== "object" || event.data === null) return
        const msg = event.data as Record<string, unknown>
        if (msg.type !== "LINKEDIN_PROFILE_RESULT") return
        cleanupListener()
        if (msg.ok && typeof msg.rawText === "string" && msg.rawText.trim().length >= 80) {
          void submitRawText(msg.rawText as string)
        } else {
          setPhase("idle")
          pushToast({
            tone: "info",
            title: "Couldn't read that LinkedIn profile",
            description:
              (typeof msg.error === "string" && msg.error) ||
              "Make sure you're logged into LinkedIn. You can also paste your profile instead.",
          })
          setPasteOpen(true)
        }
      }

      listenerRef.current = handler
      window.addEventListener("message", handler)
      window.postMessage(
        { source: "hireoven-apex", type: "IMPORT_LINKEDIN_PROFILE", ...(url ? { url } : {}) },
        "*",
      )

      timeoutRef.current = setTimeout(() => {
        cleanupListener()
        setPhase("idle")
        pushToast({
          tone: "info",
          title: "LinkedIn import timed out",
          description: "Make sure you're logged into LinkedIn, or paste your profile instead.",
        })
        setPasteOpen(true)
      }, EXTENSION_TIMEOUT_MS)
    },
    [cleanupListener, pushToast, submitRawText],
  )

  const startUrlImport = useCallback(() => {
    const url = urlText.trim()
    if (!/linkedin\.com\/in\//i.test(url)) {
      pushToast({
        tone: "error",
        title: "Enter a valid LinkedIn profile URL",
        description: "It should look like linkedin.com/in/your-name.",
      })
      return
    }
    if (!isExtensionConnected) {
      pushToast({
        tone: "info",
        title: "Hireoven extension required",
        description: "Importing by URL opens the profile in your browser. Install/enable the extension, or paste your profile instead.",
      })
      return
    }
    startExtensionImport(url)
  }, [urlText, isExtensionConnected, pushToast, startExtensionImport])

  const handleClick = useCallback(() => {
    if (phase !== "idle") return
    // Open the dialog with the URL field (primary) + paste fallback. Refresh the
    // extension connection signal so the URL path knows whether it can run.
    requestSync()
    setPasteOpen(true)
  }, [phase, requestSync])

  const busy = phase !== "idle"

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        className={cn(
          "inline-flex items-center justify-center gap-2 rounded-xl border border-[#0A66C2]/30 bg-[#0A66C2]/5 font-semibold text-[#0A66C2] transition hover:bg-[#0A66C2]/10 disabled:cursor-not-allowed disabled:opacity-60",
          compact ? "px-3 py-2 text-[13px]" : "px-4 py-2.5 text-sm",
          className
        )}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Linkedin className="h-4 w-4" />}
        {phase === "importing"
          ? "Importing from LinkedIn…"
          : phase === "submitting"
            ? "Building resume…"
            : "Import from LinkedIn"}
      </button>

      {pasteOpen && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Import from LinkedIn"
          onClick={() => !busy && setPasteOpen(false)}
        >
          <div
            className="w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-6 py-5">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-[#0A66C2]/10 text-[#0A66C2]">
                  <Linkedin className="h-4 w-4" />
                </span>
                <div>
                  <h2 className="text-lg font-bold text-slate-900">Import from LinkedIn</h2>
                  <p className="mt-0.5 text-[13px] text-slate-500">
                    Paste your profile URL and we&apos;ll read it in your browser — or paste the text yourself.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => !busy && setPasteOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="px-6 py-5">
              {/* Primary: import by URL (extension opens it in the logged-in session). */}
              <label className="block text-[13px] font-semibold text-slate-700">Your LinkedIn profile URL</label>
              <div className="mt-1.5 flex gap-2">
                <input
                  autoFocus
                  type="url"
                  value={urlText}
                  onChange={(e) => setUrlText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !busy) startUrlImport()
                  }}
                  placeholder="https://www.linkedin.com/in/your-name"
                  className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-[#0A66C2]/40 focus:ring-2 focus:ring-[#0A66C2]/10"
                />
                <button
                  type="button"
                  onClick={() => startUrlImport()}
                  disabled={busy || urlText.trim().length === 0}
                  className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-[#0A66C2] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#08538f] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {phase === "importing" && <Loader2 className="h-4 w-4 animate-spin" />}
                  Import
                </button>
              </div>
              <p className="mt-1.5 text-[12px] text-slate-400">
                {isExtensionConnected
                  ? "Opens the profile in your browser (you must be logged into LinkedIn)."
                  : "Requires the Hireoven extension + being logged into LinkedIn. No extension? Paste your profile below instead."}
              </p>

              <div className="my-4 flex items-center gap-3 text-[12px] text-slate-400">
                <span className="h-px flex-1 bg-slate-200" />
                or paste manually
                <span className="h-px flex-1 bg-slate-200" />
              </div>

              <textarea
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder="Open your LinkedIn profile, select all (⌘/Ctrl+A), copy, and paste here…"
                rows={8}
                className="w-full resize-y rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm leading-6 text-slate-800 outline-none focus:border-[#0A66C2]/40 focus:ring-2 focus:ring-[#0A66C2]/10"
              />
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-slate-100 px-6 py-4">
              <button
                type="button"
                onClick={() => !busy && setPasteOpen(false)}
                className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void submitRawText(pasteText.trim())}
                disabled={busy || pasteText.trim().length < 80}
                className="inline-flex items-center gap-2 rounded-xl bg-[#0A66C2] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#08538f] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {phase === "submitting" && <Loader2 className="h-4 w-4 animate-spin" />}
                Import pasted text
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
