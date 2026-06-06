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
          "group inline-flex w-full items-center gap-3 rounded-xl bg-white px-4 py-2.5 shadow-sm transition hover:shadow-md active:scale-[0.98]",
          className
        )}
      >
        <Linkedin className="h-4 w-4 shrink-0 text-[#0A66C2]" />
        <span className="flex-1 text-left text-[13px] font-semibold text-slate-800">Ask for a referral</span>
        <Users className="h-3.5 w-3.5 shrink-0 text-slate-300 transition group-hover:text-slate-400" />
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
