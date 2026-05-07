type VisionFeedback = {
  eye_contact_pct: number | null
  posture_notes: string
  framing_notes: string
  background_notes: string
  warnings: string[]
}

export default function DebriefDeliveryPanel({ signals }: { signals: VisionFeedback }) {
  return (
    <section>
      <h2 className="mb-3 text-[13px] font-bold uppercase tracking-wider text-sky-600">Delivery signals</h2>
      <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
        {signals.eye_contact_pct !== null && (
          <div className="flex items-center justify-between">
            <span className="text-[13px] text-slate-600">Eye contact</span>
            <span className="text-[14px] font-semibold text-slate-900">{signals.eye_contact_pct}%</span>
          </div>
        )}
        {[
          { label: "Posture", text: signals.posture_notes },
          { label: "Framing", text: signals.framing_notes },
          { label: "Background", text: signals.background_notes },
        ].filter(r => r.text).map(({ label, text }) => (
          <div key={label} className="flex items-start gap-3">
            <span className="w-24 shrink-0 text-[12px] font-semibold text-slate-400">{label}</span>
            <span className="text-[13px] text-slate-700">{text}</span>
          </div>
        ))}
        {signals.warnings.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
            {signals.warnings.map((w, i) => (
              <p key={i} className="text-[12px] text-amber-700">⚠ {w}</p>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
