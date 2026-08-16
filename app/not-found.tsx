import Link from "next/link"
import { ArrowLeft, Search } from "lucide-react"

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-white px-6 text-center">
      <div className="mb-6 inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--term-amber-soft)]">
        <Search className="h-8 w-8 text-[var(--term-amber)]" strokeWidth={2} />
      </div>

      <p className="text-sm font-bold uppercase tracking-[0.2em] text-[var(--term-amber-text)]">404</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[var(--term-strong)] sm:text-4xl">
        Page not found
      </h1>
      <p className="mt-4 max-w-sm text-base leading-relaxed text-[var(--term-dim)]">
        This page doesn&apos;t exist or was moved. Try one of the links below.
      </p>

      <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row">
        <Link
          href="/"
          className="inline-flex items-center gap-2 rounded-lg border border-[var(--term-line-strong)] bg-white px-6 py-3 text-sm font-semibold text-[var(--term-strong)] shadow-sm transition hover:bg-[var(--term-panel-2)]"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to home
        </Link>
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 rounded-lg bg-[var(--term-amber)] px-6 py-3 text-sm font-semibold text-[var(--term-amber-fg)] shadow-sm transition hover:bg-[var(--term-amber-hover)]"
        >
          Go to dashboard
        </Link>
      </div>

      <div className="mt-12 flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
        {[
          { href: "/companies", label: "Companies" },
          { href: "/pricing", label: "Pricing" },
          { href: "/extension", label: "Chrome extension" },
          { href: "/login", label: "Sign in" },
        ].map(({ href, label }) => (
          <Link
            key={href}
            href={href}
            className="text-sm text-[var(--term-dim)] transition hover:text-[var(--term-strong)]"
          >
            {label}
          </Link>
        ))}
      </div>
    </div>
  )
}
