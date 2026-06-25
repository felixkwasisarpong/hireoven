"use client"

import { useMemo, useState } from "react"
import { Check, Copy, Code2, Smartphone, Monitor, Globe, Link2, Lock, RefreshCw, type LucideIcon } from "lucide-react"
import type { PersonalScorecard } from "@/lib/scorecard/personal-scorecard"
import type { ScoreHue } from "@/types/h1b-scorecard"
import { paletteFor } from "@/lib/scorecard/hue-palette"
import { ShareControls } from "./ShareControls"

// Two-column "share & embed" section. Left column: share controls + embed studio.
// Right column: the live code snippet + a feature list. Theme/size state is shared
// across both columns (the studio drives the snippet), so they live in one client
// component. Free tier → attribution always on (enforced server-side).

type Theme = "light" | "dark" | "auto"
type Device = "desktop" | "mobile"

const SIZES = { standard: { w: 460, h: 420 }, compact: { w: 360, h: 360 } }
const THEMES: Theme[] = ["light", "dark", "auto"]

const FEATURES: { icon: LucideIcon; title: string; body: string }[] = [
  { icon: Globe, title: "Share with confidence", body: "Your scorecard is public and always up to date." },
  { icon: Link2, title: "Embed anywhere", body: "Add to your portfolio, personal site, or résumé." },
  { icon: Lock, title: "You're in control", body: "Make your card private or revoke the link anytime." },
  { icon: RefreshCw, title: "Always current", body: "Scores update automatically as your profile evolves." },
]

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="inline-flex rounded-lg bg-slate-100 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={
            value === o.value
              ? "rounded-md bg-slate-900 px-4 py-1 text-xs font-semibold text-white"
              : "rounded-md px-4 py-1 text-xs font-medium text-slate-500 hover:text-slate-700"
          }
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function ShareEmbedSection({
  card,
  shareToken,
  hue,
}: {
  card: PersonalScorecard
  shareToken: string
  hue: ScoreHue
}) {
  const p = paletteFor(hue)
  const base = typeof window !== "undefined" ? window.location.origin : "https://hireoven.com"
  const [theme, setTheme] = useState<Theme>("dark")
  const [size, setSize] = useState<keyof typeof SIZES>("standard")
  const [device, setDevice] = useState<Device>("desktop")
  const [copied, setCopied] = useState(false)

  const { w, h } = SIZES[size]
  const src = `${base}/embed/v1/personal-scorecard/${shareToken}?theme=${theme}`
  const snippet = useMemo(
    () =>
      `<iframe\n  src="${src}"\n  width="${w}"\n  height="${h}"\n  style="border:0; border-radius:12px; overflow:hidden;"\n  allowfullscreen\n></iframe>`,
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

  const frameW = device === "mobile" ? 320 : w
  const cardCls = "rounded-2xl border border-slate-200/70 bg-white p-6 shadow-[0_1px_3px_rgba(16,24,40,0.06)]"

  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-2">
      {/* LEFT: share + embed studio */}
      <div className="flex flex-col gap-6">
        <ShareControls card={card} />

        <section className={cardCls}>
          <div className="flex items-center gap-2">
            <Code2 className="h-4 w-4 text-slate-400" />
            <h2 className="text-xs font-bold uppercase tracking-[0.12em] text-slate-700">Embed your scorecard</h2>
          </div>
          <p className="mt-1 text-sm text-slate-500">Add it to your portfolio or résumé site.</p>

          <div className="mt-4 space-y-3">
            <div className="flex items-center gap-4">
              <span className="w-14 text-sm font-medium text-slate-600">Theme</span>
              <Segmented
                value={theme}
                onChange={setTheme}
                options={THEMES.map((t) => ({ value: t, label: t[0].toUpperCase() + t.slice(1) }))}
              />
            </div>
            <div className="flex items-center gap-4">
              <span className="w-14 text-sm font-medium text-slate-600">Size</span>
              <Segmented
                value={size}
                onChange={setSize}
                options={[
                  { value: "standard", label: "Standard" },
                  { value: "compact", label: "Compact" },
                ]}
              />
              <div className="ml-auto inline-flex rounded-lg bg-slate-100 p-1">
                <button
                  onClick={() => setDevice("desktop")}
                  aria-label="Desktop preview"
                  className={device === "desktop" ? "rounded-md bg-slate-900 p-1.5 text-white" : "rounded-md p-1.5 text-slate-400 hover:text-slate-600"}
                >
                  <Monitor className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => setDevice("mobile")}
                  aria-label="Mobile preview"
                  className={device === "mobile" ? "rounded-md bg-slate-900 p-1.5 text-white" : "rounded-md p-1.5 text-slate-400 hover:text-slate-600"}
                >
                  <Smartphone className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>

          <div className="mt-4 flex justify-center rounded-xl bg-[#f6f9fc] p-4">
            <iframe
              key={`${theme}-${size}-${device}`}
              src={src}
              width={frameW}
              height={h}
              style={{ border: 0, maxWidth: "100%" }}
              loading="lazy"
              title="Scorecard preview"
            />
          </div>
        </section>
      </div>

      {/* RIGHT: code + features */}
      <div className="flex flex-col gap-6">
        <section className={cardCls}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Code2 className="h-4 w-4 text-slate-400" />
              <h2 className="text-xs font-bold uppercase tracking-[0.12em] text-slate-700">Embed code</h2>
            </div>
            <button
              onClick={copy}
              className={`inline-flex items-center gap-1.5 rounded-lg border bg-white px-3 py-1.5 text-xs font-semibold ${p.text}`}
              style={{ borderColor: `${p.ring}40` }}
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? "Copied" : "Copy code"}
            </button>
          </div>
          <pre className="mt-4 overflow-x-auto rounded-xl bg-slate-900 p-4 text-[12px] leading-relaxed text-slate-200">
            <code>{snippet}</code>
          </pre>
        </section>

        <section className={cardCls}>
          <div className="space-y-5">
            {FEATURES.map((f) => (
              <div key={f.title} className="flex gap-3.5">
                <div
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                  style={{ background: p.soft }}
                >
                  <f.icon className={`h-[18px] w-[18px] ${p.text}`} strokeWidth={1.75} />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-900">{f.title}</p>
                  <p className="mt-0.5 text-sm leading-relaxed text-slate-500">{f.body}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
