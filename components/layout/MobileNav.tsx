"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Menu, X } from "lucide-react"
import { NAV_LINKS } from "./nav-links"

export default function MobileNav() {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()

  // Close the menu whenever the route changes (link tapped).
  useEffect(() => {
    setOpen(false)
  }, [pathname])

  // Lock body scroll + close on Escape while the overlay is open.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("keydown", onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.removeEventListener("keydown", onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [open])

  return (
    <div className="md:hidden">
      <button
        type="button"
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-10 w-10 items-center justify-center border border-[var(--term-line-strong)] bg-[var(--term-panel)] text-[var(--term-fg)] shadow-[0_1px_0_rgba(15,23,42,0.04)]"
      >
        {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>

      {open && (
        <>
          {/* Backdrop */}
          <button
            type="button"
            aria-label="Close menu"
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 top-[56px] z-40 bg-slate-950/45 backdrop-blur-sm"
          />
          {/* Panel */}
          <div className="fixed inset-x-0 top-[56px] z-50 border-t border-[var(--term-line-strong)] bg-[var(--term-panel)] px-4 py-3 shadow-lg">
            <nav className="flex flex-col" aria-label="Mobile">
              {NAV_LINKS.map(({ href, label, icon: Icon }) => {
                const active = pathname === href || (href !== "/" && pathname.startsWith(`${href}/`))
                return (
                  <Link
                    key={href}
                    href={href}
                    onClick={() => setOpen(false)}
                    className={`flex items-center gap-3 rounded-xl px-3 py-3 text-[15px] font-semibold transition-colors ${
                      active
                        ? "bg-[var(--term-amber)] text-[var(--term-amber-fg)]"
                        : "text-[var(--term-fg)] opacity-75 hover:bg-[var(--term-panel-2)] hover:text-[var(--term-green)] hover:opacity-100"
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0 opacity-80" aria-hidden />
                    {label}
                  </Link>
                )
              })}
            </nav>
          </div>
        </>
      )}
    </div>
  )
}
