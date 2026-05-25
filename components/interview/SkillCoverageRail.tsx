import { cn } from "@/lib/utils"

type Props = {
  skillList: string[]
  skillsCovered: string[]
  tone?: "light" | "dark"
  className?: string
}

export default function SkillCoverageRail({
  skillList,
  skillsCovered,
  tone = "light",
  className,
}: Props) {
  if (skillList.length === 0) return null

  const coveredSet = new Set(skillsCovered)
  const coveredCount = skillList.filter((skill) => coveredSet.has(skill)).length
  const pct = skillList.length > 0 ? Math.round((coveredCount / skillList.length) * 100) : 0

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {/* Header + counter */}
      <div className="flex items-center justify-between">
        <p
          className={cn(
            "text-[11px] font-semibold uppercase tracking-wider",
            tone === "dark" ? "text-slate-500" : "text-slate-400"
          )}
        >
          Skills coverage
        </p>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[10px] font-semibold tabular-nums",
            tone === "dark"
              ? "bg-white/10 text-slate-300 ring-1 ring-white/15"
              : "bg-slate-100 text-slate-600"
          )}
        >
          {coveredCount}/{skillList.length}
        </span>
      </div>

      {/* Progress bar */}
      <div className={cn("h-1.5 w-full overflow-hidden rounded-full", tone === "dark" ? "bg-white/10" : "bg-slate-100")}>
        <div
          className={cn(
            "h-full rounded-full transition-all duration-500",
            tone === "dark" ? "bg-white/60" : "bg-orange-400"
          )}
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Skill list */}
      <div className="flex flex-col gap-1.5">
        {skillList.map((skill) => {
          const covered = coveredSet.has(skill)
          return (
            <div
              key={skill}
              className={cn(
                "flex items-center gap-2 rounded-lg px-2.5 py-1.5 transition-colors",
                covered
                  ? tone === "dark"
                    ? "bg-white/[0.07] ring-1 ring-white/15"
                    : "bg-orange-50 ring-1 ring-orange-200"
                  : tone === "dark"
                    ? "bg-white/[0.02]"
                    : "bg-slate-50"
              )}
            >
              <span
                className={cn(
                  "h-1.5 w-1.5 shrink-0 rounded-full",
                  covered
                    ? tone === "dark"
                      ? "bg-white"
                      : "bg-orange-500"
                    : tone === "dark"
                      ? "bg-slate-600"
                      : "bg-slate-300"
                )}
              />
              <span
                className={cn(
                  "truncate text-[12px]",
                  covered
                    ? tone === "dark"
                      ? "font-medium text-white"
                      : "font-medium text-orange-700"
                    : tone === "dark"
                      ? "text-slate-500"
                      : "text-slate-400"
                )}
              >
                {skill}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
