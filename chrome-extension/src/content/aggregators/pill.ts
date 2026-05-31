/**
 * Vanilla-DOM CTA pill injected by aggregator handlers next to the
 * native apply button. Stands in for the brief's React `apex-pill.tsx`
 * since the extension is vanilla TS.
 *
 * Variants will be extended in Deliverable 6 (CTA fatigue suppression,
 * green/neutral/secondary, compact size).
 */

export type PillVariant = "green" | "neutral" | "secondary"
export type PillSize = "default" | "compact"

export interface PillOptions {
  variant: PillVariant
  copy: string
  subText?: string
  size?: PillSize
  testId?: string
  onClick: (event: MouseEvent) => void
  /** When true, render a small ✕ that fires onDismiss and removes the pill. */
  dismissible?: boolean
  onDismiss?: () => void
}

const APEX_PILL_DATA_ATTR = "data-apex-pill"

export function createPill(opts: PillOptions): HTMLButtonElement {
  const btn = document.createElement("button")
  btn.type = "button"
  btn.setAttribute(APEX_PILL_DATA_ATTR, "1")
  if (opts.testId) btn.setAttribute("data-testid", opts.testId)

  const palette = paletteFor(opts.variant)
  const padding = opts.size === "compact" ? "4px 10px" : "8px 14px"
  const font = opts.size === "compact" ? "12px" : "13px"

  btn.style.cssText = [
    "display: inline-flex",
    "align-items: center",
    "gap: 6px",
    `padding: ${padding}`,
    "margin-left: 8px",
    "border-radius: 9999px",
    "border: 1px solid " + palette.border,
    "background: " + palette.bg,
    "color: " + palette.text,
    `font-size: ${font}`,
    "font-weight: 600",
    "line-height: 1",
    "cursor: pointer",
    "transition: filter 120ms ease",
    "vertical-align: middle",
    "box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08)",
  ].join(";")

  btn.addEventListener("mouseenter", () => {
    btn.style.filter = "brightness(0.96)"
  })
  btn.addEventListener("mouseleave", () => {
    btn.style.filter = ""
  })

  const main = document.createElement("span")
  main.textContent = opts.copy
  btn.appendChild(main)

  if (opts.subText) {
    const sub = document.createElement("span")
    sub.textContent = opts.subText
    sub.style.cssText = "opacity: 0.8; font-weight: 500"
    btn.appendChild(sub)
  }

  btn.addEventListener("click", opts.onClick)

  if (opts.dismissible) {
    const dismiss = document.createElement("span")
    dismiss.textContent = "✕"
    dismiss.setAttribute("role", "button")
    dismiss.setAttribute("aria-label", "Dismiss Apex pill")
    dismiss.style.cssText = [
      "display: inline-flex",
      "align-items: center",
      "justify-content: center",
      "margin-left: 4px",
      "padding: 0 4px",
      "border-radius: 9999px",
      "font-size: 11px",
      "opacity: 0.7",
      "cursor: pointer",
    ].join(";")
    dismiss.addEventListener("click", (event) => {
      event.preventDefault()
      event.stopPropagation()
      opts.onDismiss?.()
      btn.remove()
    })
    btn.appendChild(dismiss)
  }

  return btn
}

/** Insert a fresh pill after `anchor`, replacing any pill already present in the same parent. */
export function injectPillAfter(anchor: Element, pill: HTMLButtonElement): void {
  injectPillsAfter(anchor, [pill])
}

/** Insert one or more pills after `anchor`, replacing any prior pills in the same parent. */
export function injectPillsAfter(anchor: Element, pills: HTMLButtonElement[]): void {
  const parent = anchor.parentElement
  if (!parent) return
  // Remove any prior apex pill the handler injected, so route changes don't stack pills.
  parent.querySelectorAll<HTMLElement>(`[${APEX_PILL_DATA_ATTR}]`).forEach((node) => node.remove())
  let cursor: Element = anchor
  for (const pill of pills) {
    cursor.insertAdjacentElement("afterend", pill)
    cursor = pill
  }
}

/** Tailwind green-500 — matches TimingPanel for visual consistency. */
const GREEN_500 = "#22c55e"
const SLATE_900 = "#0f172a"
const SLATE_200 = "#e2e8f0"
const SLATE_500 = "#64748b"

function paletteFor(variant: PillVariant): { bg: string; border: string; text: string } {
  if (variant === "green") {
    return { bg: GREEN_500, border: GREEN_500, text: "#ffffff" }
  }
  if (variant === "secondary") {
    return { bg: "#ffffff", border: SLATE_200, text: SLATE_500 }
  }
  return { bg: "#ffffff", border: SLATE_200, text: SLATE_900 }
}
