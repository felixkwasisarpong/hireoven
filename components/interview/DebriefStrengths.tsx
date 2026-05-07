type Strength = { observation: string; quote: string }

export default function DebriefStrengths({ strengths }: { strengths: Strength[] }) {
  if (strengths.length === 0) return null
  return (
    <section>
      <h2 className="mb-3 text-[13px] font-bold uppercase tracking-wider text-emerald-600">Strengths</h2>
      <div className="space-y-3">
        {strengths.map((s, i) => (
          <div key={i} className="rounded-xl border border-emerald-100 bg-emerald-50/50 pl-4 pr-4 py-3 border-l-4 border-l-emerald-500">
            <p className="text-[14px] font-semibold text-slate-900">✓ {s.observation}</p>
            {s.quote && (
              <p className="mt-1.5 text-[12px] italic text-slate-600">
                &ldquo;{s.quote}&rdquo;
              </p>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}
