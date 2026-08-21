"use client"

/**
 * Entry point into the guided optimisation conversation.
 *
 * Studio is where people land when they already know what they want to change —
 * it is a section-by-section editor. The optimiser answers a different question
 * ("what should this résumé be aiming at, and is it aimed there?"), which is
 * easy to never think to ask while you are busy rewriting a bullet. So it is
 * offered here rather than left to the sub-nav.
 *
 * Deliberately not a banner: banners in this codebase carry a dismiss and a
 * finding, and are for telling someone about a specific problem. This is a
 * standing door, so it should not disappear once dismissed.
 */

import Link from "next/link"
import { ArrowRight, Target } from "lucide-react"

export default function OptimizeEntryCard({
  /** Compact drops the description — for dense surfaces like the Studio rail. */
  compact = false,
}: {
  compact?: boolean
}) {
  return (
    <Link
      href="/dashboard/resume/optimize"
      className="group flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 transition hover:border-slate-300 hover:bg-slate-50"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-900">
        <Target className="h-4.5 w-4.5 text-white" aria-hidden />
      </span>

      <span className="min-w-0 flex-1">
        <span className="block text-[14.5px] font-semibold text-slate-900">
          Optimize this résumé
        </span>
        {!compact && (
          <span className="mt-0.5 block text-[13px] leading-relaxed text-slate-500">
            Pick the lane you are targeting and have it sharpened toward that — two questions.
          </span>
        )}
      </span>

      <ArrowRight
        className="h-4 w-4 shrink-0 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-slate-600"
        aria-hidden
      />
    </Link>
  )
}
