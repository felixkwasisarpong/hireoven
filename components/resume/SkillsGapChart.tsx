"use client"

import { useState } from "react"
import { CheckCircle2, XCircle } from "lucide-react"
import { cn } from "@/lib/utils"

type Props = {
  matching: string[]
  missing: string[]
  bonus: string[]
}

function MissingSkillPill({ skill }: { skill: string }) {
  const [hovered, setHovered] = useState(false)
  const searchUrl = `https://www.google.com/search?q=how+to+learn+${encodeURIComponent(skill)}`

  return (
    <div className="relative">
      <span
        className="inline-flex animate-pulse cursor-help items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700"
        style={{ animationDuration: "2.5s" }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <XCircle className="h-3.5 w-3.5 shrink-0" />
        {skill}
      </span>

      {hovered && (
        <div className="absolute bottom-full left-0 z-10 mb-2 w-64 rounded-2xl border border-gray-200 bg-white p-3 shadow-lg">
          <p className="text-xs font-semibold text-gray-900">Add this to your resume:</p>
          <p className="mt-1 text-xs leading-5 text-gray-600">
            Include <strong>{skill}</strong> in your skills section or describe a project where you used it.
          </p>
          <a
            href={searchUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-[#0369A1] hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            Learn {skill} →
          </a>
        </div>
      )}
    </div>
  )
}

export default function SkillsGapChart({ matching, missing, bonus }: Props) {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {/* Matching */}
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-4">
        <div className="flex items-center gap-2 mb-3">
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">
            Matching ({matching.length})
          </p>
        </div>
        {matching.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {matching.map((skill) => (
              <span
                key={skill}
                className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-white px-3 py-1.5 text-xs font-medium text-emerald-700"
              >
                <CheckCircle2 className="h-3 w-3" />
                {skill}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-xs text-gray-500">No direct skill matches found.</p>
        )}
      </div>

      {/* Missing */}
      <div className="rounded-2xl border border-red-200 bg-red-50/50 p-4">
        <div className="flex items-center gap-2 mb-3">
          <XCircle className="h-4 w-4 text-red-600" />
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-red-700">
            Missing ({missing.length})
          </p>
        </div>
        {missing.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {missing.map((skill) => (
              <MissingSkillPill key={skill} skill={skill} />
            ))}
          </div>
        ) : (
          <p className="text-xs text-gray-500">No missing required skills.</p>
        )}
      </div>

      {/* Bonus */}
      <div className="rounded-2xl border border-gray-200 bg-gray-50/50 p-4">
        <div className="mb-3">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500">
            Bonus ({bonus.length})
          </p>
        </div>
        {bonus.length > 0 ? (
          <>
            <div className="flex flex-wrap gap-2">
              {bonus.map((skill) => (
                <span
                  key={skill}
                  className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-500"
                >
                  {skill}
                </span>
              ))}
            </div>
            <p className="mt-3 text-xs text-gray-400">
              These won&apos;t hurt, but aren&apos;t required.
            </p>
          </>
        ) : (
          <p className="text-xs text-gray-500">No extra skills beyond what&apos;s required.</p>
        )}
      </div>
    </div>
  )
}
