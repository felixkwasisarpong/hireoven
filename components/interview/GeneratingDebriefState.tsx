export default function GeneratingDebriefState() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center">
      <div className="flex gap-2">
        {[0, 160, 320].map((d) => (
          <span
            key={d}
            className="h-2.5 w-2.5 rounded-full bg-orange-400 animate-bounce"
            style={{ animationDelay: `${d}ms` }}
          />
        ))}
      </div>
      <div>
        <p className="text-[15px] font-semibold text-slate-900">Building your debrief…</p>
        <p className="mt-1 text-[13px] text-slate-500">
          Claude is reviewing your transcript and generating feedback. This takes 5-15 seconds.
        </p>
      </div>
    </div>
  )
}
