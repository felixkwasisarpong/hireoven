"use client"

import { useState } from "react"
import { Linkedin, Users } from "lucide-react"
import { cn } from "@/lib/utils"
import ReferralDraftModal from "./ReferralDraftModal"

type Props = {
  jobId: string
  jobTitle: string
  companyName: string
  applyUrl: string | null
  applicationStatus?: string
  className?: string
}

export default function ReferralDraftButton({
  jobId,
  jobTitle,
  companyName,
  applyUrl,
  applicationStatus,
  className,
}: Props) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "group flex w-full items-center gap-4 rounded-2xl bg-white px-5 py-4 text-left shadow-sm transition hover:shadow-md active:scale-[0.98]",
          className
        )}
      >
        {/* Icon */}
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#0A66C2]/10 transition group-hover:bg-[#0A66C2]/15">
          <Linkedin className="h-5 w-5 text-[#0A66C2]" />
        </div>

        {/* Text */}
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-bold text-slate-900">Ask for a referral</p>
          <p className="mt-0.5 text-[12px] text-slate-500">
            Find your connections at {companyName}
          </p>
        </div>

        {/* Arrow */}
        <Users className="h-4 w-4 shrink-0 text-slate-300 transition group-hover:text-slate-400" />
      </button>

      {open && (
        <ReferralDraftModal
          jobId={jobId}
          jobTitle={jobTitle}
          companyName={companyName}
          applyUrl={applyUrl}
          applicationStatus={applicationStatus}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}
