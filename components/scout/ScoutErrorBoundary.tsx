"use client"

/**
 * ScoutErrorBoundary — React class-based error boundary for Scout surfaces.
 *
 * Wraps Scout workspace panels, context rails, and renderers so that a
 * crash in one component does not cascade to the rest of the Scout OS.
 *
 * Shows a compact, actionable fallback on error. Never shows raw stack traces.
 * Logs errors to the Scout observer (console + session ring buffer).
 */

import React from "react"
import { AlertCircle, RefreshCw } from "lucide-react"
import { cn } from "@/lib/utils"

// ── Types ─────────────────────────────────────────────────────────────────────

type Props = {
  children:    React.ReactNode
  /**
   * Optional fallback element. When omitted, the default compact
   * retry panel is shown.
   */
  fallback?:   React.ReactNode
  /** Label for the retry button. Defaults to "Try again". */
  retryLabel?: string
  /** Additional Tailwind classes on the fallback container. */
  className?:  string
  /** Surface identifier shown in dev-mode error details. */
  surface?:    string
}

type State = {
  error:     Error | null
  errorInfo: React.ErrorInfo | null
}

// ── Component ─────────────────────────────────────────────────────────────────

export class ScoutErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { error: null, errorInfo: null }
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    this.setState({ errorInfo: info })

    // Non-blocking observability — never throws, never logs sensitive values
    try {
      // Dynamic import keeps observer out of the critical path
      import("@/lib/scout/observer").then(({ scoutObserver }) => {
        scoutObserver.capture({
          type:    "render_error",
          message: error.message.slice(0, 200),
          metadata: {
            surface: this.props.surface ?? "unknown",
            componentStack: info.componentStack?.slice(0, 400) ?? "",
          },
        })
      }).catch(() => {})
    } catch {}
  }

  handleReset = () => {
    this.setState({ error: null, errorInfo: null })
  }

  render() {
    if (!this.state.error) return this.props.children

    if (this.props.fallback) return this.props.fallback

    const isDev = process.env.NODE_ENV === "development"
    const { retryLabel = "Try again", className, surface } = this.props

    return (
      <div className={cn(
        "flex flex-col items-start gap-3 rounded-xl border border-red-100 bg-red-50/60 px-4 py-4",
        className,
      )}>
        <div className="flex items-start gap-2.5">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-400" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-red-800">
              {surface ? `${surface} encountered an error` : "Something went wrong"}
            </p>
            <p className="mt-0.5 text-xs text-red-600">
              This section failed to render. Your other Scout data is safe.
            </p>
            {isDev && this.state.error && (
              <p className="mt-1.5 font-mono text-[10px] text-red-500 break-all">
                {this.state.error.message}
              </p>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={this.handleReset}
          className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-red-700 transition hover:bg-red-50"
        >
          <RefreshCw className="h-3 w-3" />
          {retryLabel}
        </button>
      </div>
    )
  }
}
