import type { Job } from '@/types'

type VisaProps = Pick<Job, 'sponsors_h1b' | 'requires_authorization' | 'visa_language_detected' | 'sponsorship_score'>

export default function VisaLanguageAlert({ sponsors_h1b, requires_authorization, visa_language_detected, sponsorship_score }: VisaProps) {
  if (requires_authorization) {
    return (
      <div className="flex gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 text-xs">
        <span className="text-red-500 shrink-0 mt-0.5 font-bold">✕</span>
        <div>
          <p className="font-semibold text-red-700 mb-0.5">No sponsorship available</p>
          {visa_language_detected && (
            <p className="text-red-600 italic">&ldquo;{visa_language_detected}&rdquo;</p>
          )}
        </div>
      </div>
    )
  }

  if (sponsors_h1b === true) {
    return (
      <div className="flex gap-2 rounded-lg border border-[#FFD2B8] bg-[#FFF7F2] px-3 py-2.5 text-xs">
        <span className="mt-0.5 shrink-0 font-bold text-[#FF5C18]">✓</span>
        <div>
          <p className="mb-0.5 font-semibold text-[#9A3412]">Sponsors H1B visas</p>
          {visa_language_detected && (
            <p className="italic text-[#FF5C18]">&ldquo;{visa_language_detected}&rdquo;</p>
          )}
        </div>
      </div>
    )
  }

  if ((sponsorship_score ?? 0) > 60) {
    return (
      <div className="flex gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 text-xs">
        <span className="text-amber-500 shrink-0 mt-0.5 font-bold">?</span>
        <p className="text-amber-700">No explicit mention - check the full job description</p>
      </div>
    )
  }

  return null
}
