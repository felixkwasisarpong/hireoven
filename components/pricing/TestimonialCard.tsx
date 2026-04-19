import { Star } from "lucide-react"

interface TestimonialCardProps {
  quote: string
  name: string
  role: string
  stars?: number
}

// TODO: replace with real testimonials
export default function TestimonialCard({ quote, name, role, stars = 5 }: TestimonialCardProps) {
  return (
    <div className="flex flex-col rounded-[20px] border border-slate-200/80 bg-white p-6 shadow-[0_1px_0_rgba(15,23,42,0.03),0_6px_20px_rgba(15,23,42,0.05)]">
      <div className="mb-4 flex gap-0.5">
        {Array.from({ length: stars }).map((_, i) => (
          <Star key={i} className="h-4 w-4 fill-amber-400 text-amber-400" />
        ))}
      </div>
      <blockquote className="flex-1 text-[15px] leading-relaxed text-slate-700">
        &ldquo;{quote}&rdquo;
      </blockquote>
      <div className="mt-5 flex items-center gap-3 border-t border-slate-100 pt-4">
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#0369A1] to-[#0284C7] text-xs font-bold text-white">
          {name.charAt(0)}
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-900">{name}</p>
          <p className="text-xs text-slate-500">{role}</p>
        </div>
      </div>
    </div>
  )
}
