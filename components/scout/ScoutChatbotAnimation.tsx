"use client"

import { Bot } from "lucide-react"
import { cn } from "@/lib/utils"

type ScoutChatbotAnimationProps = {
  className?: string
}

export function ScoutChatbotAnimation({ className }: ScoutChatbotAnimationProps) {
  return (
    <span className={cn("relative inline-flex h-full w-full items-center justify-center", className)} aria-hidden="true">
      <span className="absolute inset-[14%] rounded-[30%] border border-white/30 bg-white/10" />
      <span className="absolute left-1/2 top-[10%] h-[16%] w-[10%] -translate-x-1/2 rounded-full bg-white/70" />
      <span className="absolute left-1/2 top-[2%] h-[10%] w-[10%] -translate-x-1/2 rounded-full bg-white/90 shadow-[0_0_10px_rgba(255,255,255,0.55)]" />
      <span className="absolute left-[31%] top-[42%] h-[11%] w-[11%] rounded-full bg-white/95" />
      <span className="absolute right-[31%] top-[42%] h-[11%] w-[11%] rounded-full bg-white/95" />
      <Bot className="relative h-[52%] w-[52%] text-white" strokeWidth={2.35} />
    </span>
  )
}
