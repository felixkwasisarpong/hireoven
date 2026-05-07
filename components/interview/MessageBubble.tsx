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
          "max-w-[80%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed",
          isCandidate
            ? "rounded-tr-sm bg-orange-500 text-white shadow-[0_4px_12px_rgba(249,115,22,0.25)]"
            : "rounded-tl-sm border border-slate-100 bg-white text-slate-800 shadow-sm"
        )}
      >
        <p className="whitespace-pre-wrap break-words">{content}</p>
      </div>
    </div>
  )
}
