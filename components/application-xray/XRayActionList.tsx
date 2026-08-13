import Link from "next/link"
import { ArrowRight, CheckCircle2, ExternalLink, Lock, MessageSquare, Wrench } from "lucide-react"
import type { ActionableAccessRoute, RecommendedAction } from "@/lib/application-xray/types"
import { cn } from "@/lib/utils"
import { presentAction, resolveActionLink } from "./xray-presenters"

const ACTION_ICON = {
  apply_to_canonical_posting: ArrowRight,
  verify_posting: ExternalLink,
  surface_buried_evidence: Wrench,
  rewrite_title_or_summary: Wrench,
  add_supported_keywords: Wrench,
  reframe_transferable_experience: Wrench,
  confirm_requirement_status: CheckCircle2,
  acquire_missing_requirement: CheckCircle2,
  confirm_authorization_timeline: CheckCircle2,
  confirm_future_sponsorship_policy: MessageSquare,
  confirm_everify_participation: MessageSquare,
  confirm_stem_opt_requirement: CheckCircle2,
  contact_named_route: MessageSquare,
  consider_referral_generally: MessageSquare,
  complete_profile: CheckCircle2,
  upload_or_reparse_resume: Wrench,
  choose_different_target: ArrowRight,
} satisfies Record<RecommendedAction["kind"], React.ElementType>

export function XRayActionList({
  actions,
  accessRoutes,
  applyUrl,
  jobId,
  onActionClick,
}: {
  actions: RecommendedAction[]
  accessRoutes: ActionableAccessRoute[]
  applyUrl: string | null
  jobId: string
  onActionClick?: (action: RecommendedAction) => void
}) {
  const visibleActions = actions.slice(0, 5).map(presentAction)

  return (
    <section aria-labelledby="xray-actions-heading">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 id="xray-actions-heading" className="text-[12px] font-semibold text-slate-900 dark:text-slate-100">
          Recommended actions
        </h4>
        <span className="text-[10.5px] font-semibold text-slate-400">
          Ranked
        </span>
      </div>

      {visibleActions.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white p-3 text-[12px] leading-relaxed text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
          No action is available from the current X-Ray data.
        </p>
      ) : (
        <ol className="space-y-2.5">
          {visibleActions.map((action, index) => {
            const Icon = ACTION_ICON[action.kind]
            const link = resolveActionLink(action, accessRoutes, { applyUrl, jobId })
            return (
              <li
                key={action.id}
                className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950"
              >
                <div className="flex items-start gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-bold text-slate-600 dark:bg-slate-900 dark:text-slate-300">
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start gap-2">
                      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-orange-500" aria-hidden />
                      <div className="min-w-0">
                        <p className="text-[12.5px] font-semibold text-slate-900 dark:text-slate-100">
                          {action.label}
                        </p>
                        <p className="mt-1 text-[11.5px] leading-relaxed text-slate-500 dark:text-slate-400">
                          {action.rationale}
                        </p>
                      </div>
                    </div>

                    <div className="mt-2.5 flex flex-wrap items-center gap-2">
                      {action.requiresCandidateConfirmation ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                          <Lock className="h-3 w-3" aria-hidden />
                          Needs confirmation
                        </span>
                      ) : null}
                      {action.isDecisionBlockingConfirmation ? (
                        <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200">
                          Required before decision
                        </span>
                      ) : null}

                      {link.type === "link" ? (
                        link.external ? (
                          <a
                            href={link.href}
                            target={link.href.startsWith("mailto:") ? undefined : "_blank"}
                            rel={link.href.startsWith("mailto:") ? undefined : "noopener noreferrer"}
                            onClick={() => onActionClick?.(action)}
                            className={cn(
                              "inline-flex items-center gap-1.5 rounded-lg border border-orange-200 bg-orange-50 px-2.5 py-1 text-[11px] font-semibold text-orange-700 transition hover:bg-orange-100 dark:border-orange-400/30 dark:bg-orange-400/10 dark:text-orange-200",
                            )}
                          >
                            {link.label}
                            {link.href.startsWith("mailto:") ? null : <ExternalLink className="h-3 w-3" aria-hidden />}
                          </a>
                        ) : (
                          <Link
                            href={link.href}
                            onClick={() => onActionClick?.(action)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-orange-200 bg-orange-50 px-2.5 py-1 text-[11px] font-semibold text-orange-700 transition hover:bg-orange-100 dark:border-orange-400/30 dark:bg-orange-400/10 dark:text-orange-200"
                          >
                            {link.label}
                            <ArrowRight className="h-3 w-3" aria-hidden />
                          </Link>
                        )
                      ) : (
                        <span className="inline-flex max-w-full items-center rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                          {link.text}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
