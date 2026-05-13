export default function JobDetailLoading() {
  return (
    <main className="min-h-full bg-slate-50 pb-20">
      {/* Hero skeleton — matches the dark header */}
      <div className="relative overflow-hidden bg-[#0C1222]">
        <div className="mx-auto w-full max-w-[1340px] px-4 pt-5 sm:px-6 lg:px-8">
          <div className="h-3 w-24 animate-pulse rounded-full bg-white/5" />

          <div className="mt-6 flex items-start justify-between gap-6 pb-7">
            <div className="flex min-w-0 items-start gap-4 sm:gap-5">
              <div className="h-[68px] w-[68px] shrink-0 animate-pulse rounded-2xl bg-white/5" />
              <div className="min-w-0 flex-1 space-y-3">
                <div className="h-7 w-72 max-w-full animate-pulse rounded-md bg-white/10" />
                <div className="flex flex-wrap gap-2">
                  <div className="h-3 w-24 animate-pulse rounded-full bg-white/5" />
                  <div className="h-3 w-16 animate-pulse rounded-full bg-white/5" />
                  <div className="h-3 w-20 animate-pulse rounded-full bg-white/5" />
                  <div className="h-3 w-14 animate-pulse rounded-full bg-white/5" />
                </div>
                <div className="h-4 w-32 animate-pulse rounded-full bg-white/10" />
                <div className="flex flex-wrap gap-2 pt-1">
                  <div className="h-3 w-20 animate-pulse rounded-full bg-white/5" />
                  <div className="h-3 w-24 animate-pulse rounded-full bg-white/5" />
                </div>
              </div>
            </div>
            <div className="hidden h-12 w-36 shrink-0 animate-pulse rounded-xl bg-white/10 sm:block" />
          </div>
        </div>
      </div>

      {/* Body skeleton */}
      <div className="mx-auto w-full max-w-[1340px] px-4 py-7 sm:px-6 lg:px-8">
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px] xl:gap-8">
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="space-y-6 px-6 py-7">
              <div className="h-5 w-40 animate-pulse rounded-md bg-slate-100" />
              <div className="space-y-2.5">
                <div className="h-3 w-full animate-pulse rounded-full bg-slate-100" />
                <div className="h-3 w-[92%] animate-pulse rounded-full bg-slate-100" />
                <div className="h-3 w-[88%] animate-pulse rounded-full bg-slate-100" />
                <div className="h-3 w-[70%] animate-pulse rounded-full bg-slate-100" />
              </div>
            </div>
            <div className="space-y-3 border-t border-slate-100 px-6 py-7">
              <div className="h-5 w-32 animate-pulse rounded-md bg-slate-100" />
              <div className="flex flex-wrap gap-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-6 w-20 animate-pulse rounded-full bg-slate-100"
                  />
                ))}
              </div>
            </div>
            <div className="space-y-3 border-t border-slate-100 px-6 py-7">
              <div className="h-5 w-44 animate-pulse rounded-md bg-slate-100" />
              <div className="space-y-2.5">
                <div className="h-3 w-full animate-pulse rounded-full bg-slate-100" />
                <div className="h-3 w-[80%] animate-pulse rounded-full bg-slate-100" />
                <div className="h-3 w-[65%] animate-pulse rounded-full bg-slate-100" />
              </div>
            </div>
          </div>

          {/* Sidebar skeleton */}
          <aside className="space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="flex items-center gap-3">
                <div className="h-14 w-14 animate-pulse rounded-full bg-slate-100" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-24 animate-pulse rounded-full bg-slate-100" />
                  <div className="h-3 w-32 animate-pulse rounded-full bg-slate-100" />
                </div>
              </div>
              <div className="mt-5 space-y-2.5">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <div className="h-3 w-20 animate-pulse rounded-full bg-slate-100" />
                      <div className="h-3 w-6 animate-pulse rounded-full bg-slate-100" />
                    </div>
                    <div className="h-1.5 w-full animate-pulse rounded-full bg-slate-100" />
                  </div>
                ))}
              </div>
            </div>
            <div className="h-32 w-full animate-pulse rounded-2xl border border-slate-200 bg-white" />
          </aside>
        </div>
      </div>
    </main>
  )
}
