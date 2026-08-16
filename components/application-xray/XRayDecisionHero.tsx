import Link from "next/link"
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileQuestion,
  RefreshCw,
  Send,
  ShieldQuestion,
  UserCheck,
} from "lucide-react"
import type { ApplicationXRay, RecommendedAction } from "@/lib/application-xray/types"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { XRayConfidence, xrayToneClasses } from "./XRayConfidence"
import {
  formatXRayDate,
  getDecisionReasons,
  getPrimaryAction,
  presentAction,
  presentFinalAction,
  resolveActionLink,
} from "./xray-presenters"

const ACTION_ICON = {
  APPLY_NOW: Send,
  STRENGTHEN_FIRST: RefreshCw,
  FIND_ACCESS: UserCheck,
  SKIP: AlertTriangle,
  INSUFFICIENT_DATA: FileQuestion,
} satisfies Record<ApplicationXRay["finalAction"], React.ElementType>

export function XRayDecisionHero({
  xray,
  applyUrl,
  jobId,
  refreshing,
  onRefresh,
  onActionClick,
}: {
  xray: ApplicationXRay
  applyUrl: string | null
  jobId: string
  refreshing?: boolean
  onRefresh?: () => void
  onActionClick?: (action: RecommendedAction) => void
}) {
  // First unresolved gap, used to explain WHY an INSUFFICIENT_DATA call is blocked.
  const blockingGap = xray.dataGaps?.[0]?.label ?? null
  const actionPresentation = presentFinalAction(xray.finalAction, xray.headline, blockingGap)
  const Icon = ACTION_ICON[xray.finalAction]
  const reasons = getDecisionReasons(xray)
  const primaryAction = getPrimaryAction(xray)
  const safePrimaryAction = primaryAction ? presentAction(primaryAction) : null
  const primaryLink = safePrimaryAction
    ? resolveActionLink(safePrimaryAction, xray.accessRoutes, { applyUrl, jobId })
    : null

  return (
    <section
      aria-labelledby="xray-heading"
      className={cn(
        "rounded-xl border p-4",
        xrayToneClasses(actionPresentation.tone),
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/80 text-slate-800 ring-1 ring-black/5 dark:bg-slate-950/70 dark:text-slate-100">
              <Icon className="h-4 w-4" aria-hidden />
            </span>
            <div>
              <p className="text-[10.5px] font-bold uppercase text-current opacity-70">
                Application X-Ray
              </p>
              <h3 id="xray-heading" className="text-[18px] font-bold leading-tight text-current">
                {actionPresentation.label}
              </h3>
            </div>
          </div>

          <p className="mt-3 text-[13px] font-semibold leading-relaxed text-current">
            {actionPresentation.headline}
          </p>
          <p className="mt-1 text-[12px] leading-relaxed opacity-85">
            {actionPresentation.description}
          </p>
        </div>

        {onRefresh ? (
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/80 text-current ring-1 ring-black/5 transition hover:bg-white disabled:opacity-60 dark:bg-slate-950/70 dark:hover:bg-slate-900"
            aria-label="Refresh analysis"
            title="Refresh analysis"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin motion-reduce:animate-none")} aria-hidden />
          </button>
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <XRayConfidence confidence={xray.confidence} className="bg-white/80 dark:bg-slate-950/70" />
        <span className="inline-flex items-center gap-1 rounded-full border border-current/20 bg-white/70 px-2 py-0.5 text-[10.5px] font-semibold text-current dark:bg-slate-950/60">
          <Clock className="h-3 w-3" aria-hidden />
          {formatXRayDate(xray.computedAt)}
        </span>
        <span className="inline-flex items-center gap-1 rounded-full border border-current/20 bg-white/70 px-2 py-0.5 text-[10.5px] font-semibold text-current dark:bg-slate-950/60">
          <ShieldQuestion className="h-3 w-3" aria-hidden />
          {xray.resumeId ? "Resume analyzed" : "No resume selected"}
        </span>
      </div>

      {reasons.length > 0 ? (
        <ul className="mt-3 space-y-1.5">
          {reasons.map((reason) => (
            <li key={reason} className="flex gap-2 text-[12px] leading-relaxed opacity-90">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>{reason}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {safePrimaryAction ? (
        <div className="mt-4 rounded-lg bg-white/70 p-3 ring-1 ring-current/10 dark:bg-slate-950/50">
          <p className="text-[11px] font-semibold uppercase text-current opacity-65">
            Next action
          </p>
          <p className="mt-1 text-[12.5px] font-semibold leading-relaxed text-current">
            {safePrimaryAction.label}
          </p>
          <p className="mt-1 text-[11.5px] leading-relaxed opacity-80">
            {safePrimaryAction.rationale}
          </p>
          {primaryLink?.type === "link" ? (
            primaryLink.external ? (
              <a
                href={primaryLink.href}
                target={primaryLink.href.startsWith("mailto:") ? undefined : "_blank"}
                rel={primaryLink.href.startsWith("mailto:") ? undefined : "noopener noreferrer"}
                onClick={() => onActionClick?.(safePrimaryAction)}
                className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-slate-950 px-3 py-1.5 text-[12px] font-semibold text-white transition hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200"
              >
                {primaryLink.label}
                {primaryLink.href.startsWith("mailto:") ? null : <ExternalLink className="h-3.5 w-3.5" aria-hidden />}
              </a>
            ) : (
              <Button asChild size="sm" className="mt-3 h-8 px-3 text-[12px]">
                <Link href={primaryLink.href} onClick={() => onActionClick?.(safePrimaryAction)}>
                  {primaryLink.label}
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                </Link>
              </Button>
            )
          ) : primaryLink ? (
            <p className="mt-3 rounded-lg border border-current/15 bg-white/70 px-3 py-2 text-[11.5px] leading-relaxed opacity-85 dark:bg-slate-950/60">
              {primaryLink.text}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
