"use client"

import { cn } from "@/lib/utils"
import type { SponsorshipApproach } from "@/types"

type Props = {
  value: SponsorshipApproach
  onChange: (approach: SponsorshipApproach) => void
  companyName?: string
  sponsorshipScore?: number
  h1bCount1yr?: number
}

const APPROACHES: Array<{
  value: SponsorshipApproach
  label: string
  description: string
  example?: string
}> = [
  {
    value: "omit",
    label: "Omit",
    description: "Don't mention sponsorship in the letter. Address it if asked.",
    example: undefined,
  },
  {
    value: "proactive",
    label: "Proactive",
    description: "Mention it confidently in the letter - one matter-of-fact sentence.",
    example:
      "I will require H1B visa sponsorship. I understand you have a strong track record of sponsoring international candidates, and I'm happy to discuss the process at any stage.",
  },
  {
    value: "on_request",
    label: "On request",
    description: "Add a subtle note that you're open to discussing work authorization.",
    example:
      "I am open to discussing work authorization requirements during the interview process.",
  },
]

function sponsorshipLabel(score: number, count1yr: number, companyName: string): string {
  if (count1yr > 50)
    return `${companyName} sponsored ${count1yr} H1B petitions last year - very likely to support you.`
  if (count1yr > 10)
    return `${companyName} sponsored ${count1yr} H1B petitions last year.`
  if (score >= 60)
    return `${companyName} has a ${score}% sponsorship confidence score - likely sponsors.`
  if (score >= 30)
    return `${companyName} has a ${score}% sponsorship confidence score - may sponsor in some cases.`
  return `${companyName} has limited sponsorship history - consider the "omit" approach.`
}

export default function SponsorshipHelper({
  value,
  onChange,
  companyName = "This company",
  sponsorshipScore = 0,
  h1bCount1yr = 0,
}: Props) {
  const contextLabel = sponsorshipLabel(sponsorshipScore, h1bCount1yr, companyName)

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
        {contextLabel}
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {APPROACHES.map((approach) => {
          const selected = value === approach.value
          return (
            <button
              key={approach.value}
              type="button"
              onClick={() => onChange(approach.value)}
              className={cn(
                "rounded-2xl border p-3 text-left transition",
                selected
                  ? "border-[#0369A1] bg-[#F0F9FF] ring-1 ring-[#0369A1]"
                  : "border-gray-200 bg-white hover:border-gray-300"
              )}
            >
              <span
                className={cn(
                  "text-sm font-semibold",
                  selected ? "text-[#0369A1]" : "text-gray-900"
                )}
              >
                {approach.label}
              </span>
              <p className="mt-1 text-xs text-gray-500">{approach.description}</p>
            </button>
          )
        })}
      </div>

      {APPROACHES.find((a) => a.value === value)?.example && (
        <div className="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3">
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">
            Example language
          </p>
          <p className="text-sm italic leading-6 text-gray-600">
            &ldquo;{APPROACHES.find((a) => a.value === value)!.example}&rdquo;
          </p>
        </div>
      )}
    </div>
  )
}
