import { cn } from "@/lib/utils"

type Props = {
  skillList: string[]
  skillsCovered: string[]
}

export default function SkillCoverageRail({ skillList, skillsCovered }: Props) {
  if (skillList.length === 0) return null

  const coveredSet = new Set(skillsCovered)

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        Skills coverage
      </p>
      {skillList.map((skill) => {
        const covered = coveredSet.has(skill)
        return (
          <div
            key={skill}
            className={cn(
              "flex items-center gap-2 rounded-lg border px-2.5 py-1.5 transition-colors",
              covered
                ? "border-orange-200 bg-orange-50"
                : "border-slate-100 bg-white"
            )}
          >
            <span
              className={cn(
                "h-2 w-2 shrink-0 rounded-full",
                covered ? "bg-orange-500" : "bg-slate-200"
              )}
            />
            <span
              className={cn(
                "truncate text-[12px] font-medium",
                covered ? "text-orange-700" : "text-slate-500"
              )}
            >
              {skill}
            </span>
          </div>
        )
      })}
    </div>
  )
}
