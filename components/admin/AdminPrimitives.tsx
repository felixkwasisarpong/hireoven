import { cn } from "@/lib/utils"

export function AdminPageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string
  title: string
  description: string
  actions?: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-4 border-b border-gray-200 pb-6 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-sky-700">
          {eyebrow}
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-gray-950">
          {title}
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-500">{description}</p>
      </div>
      {actions ? <div className="flex flex-wrap gap-3">{actions}</div> : null}
    </div>
  )
}

export function AdminStatCard({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string
  value: string
  hint?: string
  tone?: "default" | "success" | "danger" | "info"
}) {
  return (
    <div className="rounded-3xl border border-gray-200 bg-white p-5 shadow-[0_12px_30px_rgba(15,23,42,0.05)]">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-gray-500">
        {label}
      </p>
      <p
        className={cn(
          "mt-3 text-3xl font-semibold tracking-tight text-gray-950",
          tone === "success" && "text-emerald-600",
          tone === "danger" && "text-red-600",
          tone === "info" && "text-sky-700"
        )}
      >
        {value}
      </p>
      {hint ? <p className="mt-2 text-sm text-gray-500">{hint}</p> : null}
    </div>
  )
}

export function AdminPanel({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: string
  description?: string
  actions?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section
      className={cn(
        "rounded-3xl border border-gray-200 bg-white p-5 shadow-[0_12px_30px_rgba(15,23,42,0.05)]",
        className
      )}
    >
      <div className="mb-4 flex flex-col gap-3 border-b border-gray-100 pb-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-950">{title}</h2>
          {description ? (
            <p className="mt-1 text-sm leading-6 text-gray-500">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  )
}

export function AdminBadge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode
  tone?:
    | "neutral"
    | "success"
    | "danger"
    | "warning"
    | "info"
    | "dark"
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold",
        tone === "neutral" && "bg-gray-100 text-gray-700",
        tone === "success" && "bg-emerald-50 text-emerald-700",
        tone === "danger" && "bg-red-50 text-red-700",
        tone === "warning" && "bg-amber-50 text-amber-700",
        tone === "info" && "bg-sky-50 text-sky-700",
        tone === "dark" && "bg-gray-900 text-gray-100"
      )}
    >
      {children}
    </span>
  )
}

export function AdminButton({
  children,
  tone = "primary",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: "primary" | "secondary" | "danger" | "ghost"
}) {
  return (
    <button
      {...props}
      className={cn(
        "inline-flex items-center justify-center rounded-2xl px-4 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50",
        tone === "primary" && "bg-sky-700 text-white hover:bg-sky-800",
        tone === "secondary" &&
          "border border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50",
        tone === "danger" && "bg-red-600 text-white hover:bg-red-700",
        tone === "ghost" && "text-gray-600 hover:bg-gray-100 hover:text-gray-900",
        className
      )}
    >
      {children}
    </button>
  )
}

export function AdminInput(
  props: React.InputHTMLAttributes<HTMLInputElement> & { className?: string }
) {
  return (
    <input
      {...props}
      className={cn(
        "w-full rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/15",
        props.className
      )}
    />
  )
}

export function AdminSelect(
  props: React.SelectHTMLAttributes<HTMLSelectElement> & { className?: string }
) {
  return (
    <select
      {...props}
      className={cn(
        "w-full rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/15",
        props.className
      )}
    />
  )
}
