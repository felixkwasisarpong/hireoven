"use client"

import { useState } from "react"
import { Users } from "lucide-react"
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
          "inline-flex items-center gap-2 rounded-xl border border-slate-600/40 bg-white/5 px-4 py-2 text-[13px] font-medium text-slate-300 backdrop-blur-sm transition hover:border-slate-500 hover:bg-white/10 hover:text-white",
          className
        )}
      >
        <Users className="h-3.5 w-3.5" aria-hidden />
        Ask for referral
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
