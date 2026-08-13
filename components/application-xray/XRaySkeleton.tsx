export function XRaySkeleton() {
  return (
    <section
      aria-label="Application X-Ray loading"
      className="space-y-4"
    >
      <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
        <div className="h-3 w-28 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
        <div className="mt-4 h-7 w-44 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
        <div className="mt-3 h-3 w-full animate-pulse rounded bg-slate-100 dark:bg-slate-900" />
        <div className="mt-2 h-3 w-3/4 animate-pulse rounded bg-slate-100 dark:bg-slate-900" />
      </div>
      <div className="space-y-2.5">
        {Array.from({ length: 5 }).map((_, index) => (
          <div
            key={index}
            className="h-24 animate-pulse rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950"
          />
        ))}
      </div>
    </section>
  )
}
