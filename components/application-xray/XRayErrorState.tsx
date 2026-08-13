import Link from "next/link"
import { AlertCircle, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export type XRayLoadError = {
  status: number | null
  message: string
}

function copyForError(error: XRayLoadError): { title: string; body: string; action?: "login" | "retry" } {
  if (error.status === 401) {
    return {
      title: "Sign in to view Application X-Ray.",
      body: "This analysis is only available on your authenticated workspace.",
      action: "login",
    }
  }
  if (error.status === 403 || error.status === 404) {
    return {
      title: "X-Ray is not available for this job or resume.",
      body: "The analysis could not be opened from this workspace.",
    }
  }
  return {
    title: "X-Ray could not load right now.",
    body: "The job page is still usable. Retry when the backend is reachable.",
    action: "retry",
  }
}

export function XRayErrorState({
  error,
  onRetry,
  compact = false,
}: {
  error: XRayLoadError
  onRetry?: () => void
  compact?: boolean
}) {
  const copy = copyForError(error)
  return (
    <div
      role="status"
      className={cn(
        "rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-100",
        compact && "p-3",
      )}
    >
      <div className="flex items-start gap-3">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold">{copy.title}</p>
          <p className="mt-1 text-[12px] leading-relaxed opacity-80">{copy.body}</p>
          {copy.action === "login" ? (
            <Link
              href="/login"
              className="mt-3 inline-flex rounded-lg bg-white px-3 py-1.5 text-[12px] font-semibold text-amber-800 ring-1 ring-amber-200 transition hover:bg-amber-100 dark:bg-slate-950 dark:text-amber-100 dark:ring-amber-400/30"
            >
              Sign in
            </Link>
          ) : copy.action === "retry" && onRetry ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onRetry}
              className="mt-3 h-8 border-amber-200 bg-white text-[12px] text-amber-800 hover:bg-amber-100 dark:border-amber-400/30 dark:bg-slate-950 dark:text-amber-100"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden />
              Try again
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
