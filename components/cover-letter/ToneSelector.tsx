"use client"

import { cn } from "@/lib/utils"
import type { CoverLetterTone } from "@/types"

type Props = {
  value: CoverLetterTone
  onChange: (tone: CoverLetterTone) => void
  companyName?: string
  jobTitle?: string
}

const TONES: Array<{
  value: CoverLetterTone
  label: string
  description: string
  example: (company: string, title: string) => string
}> = [
  {
    value: "professional",
    label: "Professional",
    description: "Polished and direct. Confident without being stiff.",
    example: (company, title) =>
      `With seven years building data pipelines at scale, I was immediately drawn to ${company}'s infrastructure challenges in the ${title} role.`,
  },
  {
    value: "conversational",
    label: "Conversational",
    description: "Warm and human. Like a smart colleague writing to another.",
    example: (company, _title) =>
      `When I saw this role at ${company}, I immediately thought — this is exactly the problem I've been working on for the past three years.`,
  },
  {
    value: "enthusiastic",
    label: "Enthusiastic",
    description: "Genuine energy. No clichés — real excitement.",
    example: (company, _title) =>
      `Building products that help millions of people communicate better is what gets me up every morning — which is why ${company}'s mission stopped me mid-scroll.`,
  },
  {
    value: "formal",
    label: "Formal",
    description: "Traditional and conservative. Right for finance, law, or government.",
    example: (company, title) =>
      `I am pleased to submit my application for the ${title} position at ${company}, having followed the organization's work with considerable interest.`,
  },
]

export default function ToneSelector({ value, onChange, companyName = "the company", jobTitle = "this role" }: Props) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {TONES.map((tone) => {
        const selected = value === tone.value
        return (
          <button
            key={tone.value}
            type="button"
            onClick={() => onChange(tone.value)}
            className={cn(
              "rounded-2xl border p-4 text-left transition",
              selected
                ? "border-[#0369A1] bg-[#F0F9FF] ring-1 ring-[#0369A1]"
                : "border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50"
            )}
          >
            <div className="flex items-center justify-between">
              <span
                className={cn(
                  "text-sm font-semibold",
                  selected ? "text-[#0369A1]" : "text-gray-900"
                )}
              >
                {tone.label}
              </span>
              {selected && (
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#0369A1]">
                  <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 12 12">
                    <path
                      d="M2 6l3 3 5-5"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-gray-500">{tone.description}</p>
            <p className="mt-2.5 rounded-xl bg-gray-50 px-3 py-2 text-xs italic leading-5 text-gray-600 border border-gray-100">
              &ldquo;{tone.example(companyName, jobTitle)}&rdquo;
            </p>
          </button>
        )
      })}
    </div>
  )
}
