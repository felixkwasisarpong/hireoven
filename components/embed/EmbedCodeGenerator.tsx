"use client"

import { useMemo, useState } from "react"
import { Check, Code2 } from "lucide-react"

// Consumer-side embed snippet builder shown on /dashboard/scorecard once the user
// has published their card. Generates a copy-paste <iframe> for their own personal
// scorecard widget (free tier → attribution always on, enforced server-side).

type Theme = "light" | "dark" | "auto"

const SIZES = { compact: { w: 360, h: 300 }, standard: { w: 460, h: 320 } }

export function EmbedCodeGenerator({ shareToken }: { shareToken: string }) {
  const base = typeof window !== "undefined" ? window.location.origin : "https://hireoven.com"
  const [theme, setTheme] = useState<Theme>("light")
  const [size, setSize] = useState<keyof typeof SIZES>("standard")
  const [copied, setCopied] = useState(false)

  const { w, h } = SIZES[size]
  const src = `${base}/embed/v1/personal-scorecard/${shareToken}?theme=${theme}`
  const snippet = useMemo(
    () =>
      `<iframe src="${src}" width="${w}" height="${h}" style="border:0;max-width:100%" loading="lazy" title="H-1B Sponsorability Scorecard"></iframe>`,
    [src, w, h]
  )

  async function copy() {
    try {
      await navigator.clipboard.writeText(snippet)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      /* ignore */
    }
  }

  return (
    <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex items-center gap-2">
        <Code2 className="h-4 w-4 text-slate-500" />
        <h2 className="text-sm font-semibold text-slate-900">Embed your scorecard</h2>
      </div>
      <p className="mt-1 text-sm text-slate-500">
        Drop this on your portfolio, blog, or personal site. It updates automatically when you
        recompute your score.
      </p>

      <div className="mt-4 flex flex-wrap gap-4">
        <label className="text-sm">
          <span className="mr-2 text-slate-600">Theme</span>
          <select
            value={theme}
            onChange={(e) => setTheme(e.target.value as Theme)}
            className="rounded-lg border border-slate-200 px-2 py-1 text-sm"
          >
            <option value="light">Light</option>
            <option value="dark">Dark</option>
            <option value="auto">Auto</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="mr-2 text-slate-600">Size</span>
          <select
            value={size}
            onChange={(e) => setSize(e.target.value as keyof typeof SIZES)}
            className="rounded-lg border border-slate-200 px-2 py-1 text-sm"
          >
            <option value="standard">Standard</option>
            <option value="compact">Compact</option>
          </select>
        </label>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">Preview</div>
          <div className="overflow-hidden rounded-lg border border-slate-100 bg-slate-50 p-3">
            <iframe
              key={`${theme}-${size}`}
              src={src}
              width={w}
              height={h}
              style={{ border: 0, maxWidth: "100%" }}
              loading="lazy"
              title="Scorecard preview"
            />
          </div>
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-400">Embed code</span>
            <button
              onClick={copy}
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Code2 className="h-3.5 w-3.5" />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <pre className="overflow-x-auto rounded-lg bg-slate-900 p-3 text-[11px] leading-relaxed text-slate-100">
            <code>{snippet}</code>
          </pre>
        </div>
      </div>
    </section>
  )
}
