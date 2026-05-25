import ScoreCircle from "@/components/interview/ScoreCircle"

const TYPE_LABELS: Record<string, string> = { text: "Text", live: "Live", coding: "Coding" }
const PERSONA_LABELS: Record<string, string> = {
  friendly_recruiter: "Friendly Recruiter",
  skeptical_hm: "Skeptical HM",
  senior_staff: "Senior Staff",
  founder: "Founder",
  panel: "Panel",
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

type Props = {
  score: number
  headline: string
  type: string
  persona: string
  jobTitle: string | null
  jobCompany: string | null
  sessionDate: string
  durationMin: number
}

export default function DebriefHero({ score, headline, type, persona, jobTitle, jobCompany, sessionDate, durationMin }: Props) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_2px_16px_rgba(15,23,42,0.06)]">
      <div className="h-1 w-full bg-gradient-to-r from-[#ff6a3d] via-[#f26c2f] to-[#ff8f2b]" />
      <div className="p-6">
        <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center sm:gap-6">
          <div className="shrink-0 rounded-2xl bg-orange-50 p-2 ring-1 ring-orange-100">
            <ScoreCircle score={score} />
          </div>
          <div className="min-w-0 flex-1 text-center sm:text-left">
            <p className="text-[17px] font-bold leading-snug text-slate-900">{headline}</p>
            <div className="mt-3 flex flex-wrap justify-center gap-1.5 sm:justify-start">
              {[
                TYPE_LABELS[type] ?? type,
                PERSONA_LABELS[persona] ?? persona,
                jobTitle ? `${jobTitle}${jobCompany ? ` @ ${jobCompany}` : ""}` : "Generic",
                formatDate(sessionDate),
                `${durationMin} min`,
              ].map((label, i) => (
                <span key={i} className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-[11px] font-medium text-slate-600">
                  {label}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
