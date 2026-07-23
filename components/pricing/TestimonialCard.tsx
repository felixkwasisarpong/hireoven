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
    <div className="term-panel flex flex-col p-6">
      <div className="mb-4 flex gap-0.5">
        {Array.from({ length: stars }).map((_, i) => (
          <Star key={i} className="h-4 w-4 fill-[#f5a623] text-[#f5a623]" />
        ))}
      </div>
      <blockquote className="flex-1 text-[15px] leading-relaxed text-[#ccd6cf]/80">
        &ldquo;{quote}&rdquo;
      </blockquote>
      <div className="mt-5 flex items-center gap-3 border-t border-[rgba(120,200,160,0.12)] pt-4">
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center bg-[#f5a623] text-xs font-bold text-[#0a0e0c]">
          {name.charAt(0)}
        </div>
        <div>
          <p className="text-sm font-semibold text-white">{name}</p>
          <p className="text-xs text-[#ccd6cf]/55">{role}</p>
        </div>
      </div>
    </div>
  )
}
