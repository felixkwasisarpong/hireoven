"use client"

import { useEffect, useState } from "react"
import { Moon, Sun } from "lucide-react"

const STORAGE_KEY = "hireoven:marketing-theme"

type MarketingTheme = "dark" | "light"

function applyTheme(theme: MarketingTheme) {
  document.documentElement.dataset.marketingTheme = theme
}

export default function MarketingThemeToggle() {
  const [theme, setTheme] = useState<MarketingTheme>("dark")

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    const initialTheme: MarketingTheme = stored === "light" ? "light" : "dark"
    setTheme(initialTheme)
    applyTheme(initialTheme)
  }, [])

  function toggleTheme() {
    const nextTheme: MarketingTheme = theme === "dark" ? "light" : "dark"
    setTheme(nextTheme)
    window.localStorage.setItem(STORAGE_KEY, nextTheme)
    applyTheme(nextTheme)
  }

  const isDark = theme === "dark"
  const Icon = isDark ? Sun : Moon

  return (
    <button
      type="button"
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      aria-pressed={!isDark}
      onClick={toggleTheme}
      className="inline-flex h-10 w-10 shrink-0 items-center justify-center border border-[var(--term-line-strong)] bg-[var(--term-panel)] text-[var(--term-fg)] transition hover:border-[var(--term-green)] hover:text-[var(--term-green)]"
      title={isDark ? "Light theme" : "Dark theme"}
    >
      <Icon className="h-4 w-4" aria-hidden />
    </button>
  )
}
