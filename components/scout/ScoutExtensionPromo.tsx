"use client"

/**
 * ScoutExtensionPromo — lightweight, dismissable extension capability card.
 *
 * Shown in IdleMode when the extension is not connected.
 * Non-blocking: user can dismiss and use Scout without the extension.
 * No aggressive banners. No guilt.
 */

import { Chrome, Globe, X, Zap } from "lucide-react"

type Props = {
  onDismiss: () => void
}

const CAPABILITIES = [
  { icon: Zap,    label: "Autofill application forms"     },
  { icon: Globe,  label: "Browser context awareness"      },
  { icon: Chrome, label: "Workflow continuation on-page"  },
]

export function ScoutExtensionPromo({ onDismiss }: Props) {
  return (
    <div className="mb-6 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-start gap-3 px-4 py-3.5">
        {/* Icon */}
        <div className="flex-shrink-0 mt-0.5">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-[#FF5C18]/10">
            <Chrome className="h-4 w-4 text-[#FF5C18]" />
          </span>
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] font-semibold text-slate-900">
            Scout works best with the browser extension
          </p>

          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            {CAPABILITIES.map(({ icon: Icon, label }) => (
              <span key={label} className="flex items-center gap-1.5 text-[11px] text-slate-500">
                <Icon className="h-3 w-3 flex-shrink-0 text-slate-400" />
                {label}
              </span>
            ))}
          </div>

          <div className="mt-3 flex items-center gap-3">
            <a
              href="https://chrome.google.com/webstore/detail/hireoven"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-950 px-3 py-1.5 text-[11px] font-semibold text-white transition hover:bg-slate-800"
            >
              <Chrome className="h-3 w-3" />
              Install Chrome extension
            </a>
            <button
              type="button"
              onClick={onDismiss}
              className="text-[11px] font-medium text-slate-400 transition hover:text-slate-600"
            >
              Not now
            </button>
          </div>
        </div>

        {/* Dismiss */}
        <button
          type="button"
          onClick={onDismiss}
          className="flex-shrink-0 rounded text-slate-300 transition hover:text-slate-500"
          aria-label="Dismiss extension prompt"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}
