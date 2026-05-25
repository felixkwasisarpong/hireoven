import { cn } from "@/lib/utils"

type Props = {
  role: "interviewer" | "candidate"
  content: string
}

export default function MessageBubble({ role, content }: Props) {
  const isCandidate = role === "candidate"

  return (
    <div className={cn("flex", isCandidate ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[82%] rounded-2xl px-4 py-3 text-[13px] leading-relaxed",
          isCandidate
            ? "rounded-tr-sm bg-gradient-to-br from-[#ff7b38] to-[#eb5d1f] text-white shadow-[0_8px_20px_rgba(235,93,31,0.22)]"
            : "rounded-tl-sm border border-[#ede7e1] bg-white text-slate-800 shadow-[0_2px_8px_rgba(15,23,42,0.05)]"
        )}
      >
        <p className="whitespace-pre-wrap break-words">{content}</p>
      </div>
    </div>
  )
}
