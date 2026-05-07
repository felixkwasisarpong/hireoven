type BetterAnswer = { question: string; your_answer: string; stronger_answer: string }

export default function DebriefBetterAnswers({ answers }: { answers: BetterAnswer[] }) {
  if (answers.length === 0) return null
  return (
    <section>
      <h2 className="mb-3 text-[13px] font-bold uppercase tracking-wider text-slate-600">Stronger answers</h2>
      <div className="space-y-4">
        {answers.map((a, i) => (
          <div key={i} className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <div className="border-b border-slate-100 px-4 py-2.5">
              <p className="text-[12px] font-semibold text-slate-500">Q: {a.question}</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2">
              <div className="border-b border-slate-100 bg-slate-50 px-4 py-3 sm:border-b-0 sm:border-r">
                <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">Your answer</p>
                <p className="text-[13px] leading-relaxed text-slate-700">{a.your_answer}</p>
              </div>
              <div className="bg-orange-50/40 px-4 py-3">
                <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-orange-500">Stronger version</p>
                <p className="text-[13px] leading-relaxed text-slate-800">{a.stronger_answer}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
