import type { LucideIcon } from "lucide-react"
import { ArrowUpRight } from "lucide-react"
import { cn } from "@/lib/utils"

type GrowPageSignal = {
  label: string
  value: string
}

type GrowPageShellProps = {
  kicker: string
  title: string
  description: string
  icon: LucideIcon
  signals?: GrowPageSignal[]
  children: React.ReactNode
  className?: string
}

export default function GrowPageShell({
  kicker,
  title,
  description,
  icon: Icon,
  signals = [],
  children,
  className,
}: GrowPageShellProps) {
  return (
    <div className={cn("min-h-full bg-slate-50/70", className)}>
      <section className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="flex min-w-0 gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-orange-200 bg-orange-50 text-orange-600">
                <Icon className="h-5 w-5" strokeWidth={1.9} aria-hidden />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-orange-600">
                  {kicker}
                </p>
                <h1 className="mt-2 text-2xl font-semibold leading-tight text-slate-950 sm:text-3xl">
                  {title}
                </h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                  {description}
                </p>
              </div>
            </div>

            {signals.length > 0 && (
              <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-3 lg:w-[420px]">
                {signals.map((signal) => (
                  <div
                    key={`${signal.label}-${signal.value}`}
                    className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
                  >
                    <p className="truncate text-[11px] font-medium text-slate-500">{signal.label}</p>
                    <p className="mt-0.5 flex items-center gap-1 text-[13px] font-semibold text-slate-900">
                      {signal.value}
                      <ArrowUpRight className="h-3 w-3 text-orange-500" aria-hidden />
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
        {children}
      </div>
    </div>
  )
}
