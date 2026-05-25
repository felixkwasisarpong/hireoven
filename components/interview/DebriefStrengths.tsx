type Strength = { observation: string; quote: string }

export default function DebriefStrengths({ strengths }: { strengths: Strength[] }) {
  if (strengths.length === 0) return null
  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        <div className="h-4 w-0.5 rounded-full bg-emerald-500" />
        <h2 className="text-[12px] font-bold uppercase tracking-widest text-emerald-600">Strengths</h2>
      </div>
      <div className="space-y-2.5">
        {strengths.map((s, i) => (
          <div key={i} className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-4">
            <p className="flex items-start gap-2.5 text-[13px] font-semibold text-slate-900">
              <span className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-[10px] font-bold text-white">✓</span>
              {s.observation}
            </p>
            {s.quote && (
              <p className="mt-2 pl-7 text-[12px] italic leading-relaxed text-slate-500">
                &ldquo;{s.quote}&rdquo;
              </p>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}
