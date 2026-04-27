import { Users, TrendingUp } from "lucide-react"
import { cn } from "@/lib/utils"

type OpportunitySignalBadgesProps = {
  showTopApplicant: boolean
  showSalaryStrong: boolean
  topApplicantTitle: string
  salaryStrongTitle: string
  className?: string
}

export function OpportunitySignalBadges({
  showTopApplicant,
  showSalaryStrong,
  topApplicantTitle,
  salaryStrongTitle,
  className,
}: OpportunitySignalBadgesProps) {
  if (!showTopApplicant && !showSalaryStrong) return null
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {showTopApplicant && (
        <span
          className="inline-flex max-w-full items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-[11px] font-semibold text-slate-700"
          title={topApplicantTitle}
        >
          <Users className="h-3 w-3 shrink-0" aria-hidden />
          Top applicant opportunity
        </span>
      )}
      {showSalaryStrong && (
        <span
          className="inline-flex max-w-full items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-900"
          title={salaryStrongTitle}
        >
          <TrendingUp className="h-3 w-3 shrink-0" aria-hidden />
          Salary strong
        </span>
      )}
    </div>
  )
}
