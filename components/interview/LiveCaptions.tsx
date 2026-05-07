"use client"

import { useEffect, useRef } from "react"
import { cn } from "@/lib/utils"

export type CaptionItem = {
  id: string
  role: "interviewer" | "candidate"
  content: string
  partial?: boolean
}

type Props = {
  captions: CaptionItem[]
}

export default function LiveCaptions({ captions }: Props) {
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [captions])

  return (
    <div className="flex flex-col gap-2 overflow-y-auto">
      {captions.length === 0 && (
        <p className="text-center text-[12px] text-slate-400">
          Live captions will appear here once the call starts.
        </p>
      )}

      {captions.map((item) => {
        const isCandidate = item.role === "candidate"
        return (
          <div key={item.id} className={cn("flex", isCandidate ? "justify-end" : "justify-start")}>
            <div
              className={cn(
                "max-w-[90%] rounded-xl px-2.5 py-1.5 text-[12px] leading-relaxed",
                item.partial ? "opacity-60" : "opacity-100",
                isCandidate
                  ? "bg-orange-500 text-white"
                  : "border border-slate-200 bg-white text-slate-800"
              )}
            >
              {item.content}
              {item.partial && <span className="ml-0.5 animate-pulse">▋</span>}
            </div>
          </div>
        )
      })}

      <div ref={endRef} />
    </div>
  )
}
