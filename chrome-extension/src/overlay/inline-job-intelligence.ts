import type { JobCardSnapshot, OverlayCardRole } from "./site-adapters"

export type OverlayVisaTier = "positive" | "warn" | "neutral" | "none"
export type PrimarySignal = "match" | "visa" | "tailor" | "queue" | "check"

export interface InlineOverlayModel {
  key: string
  role: OverlayCardRole
  matchPercent: number | null
  matchLabel: string
  visaTier: OverlayVisaTier
  visaLabel: string
  primarySignal: PrimarySignal
  active: boolean
  selected: boolean
  checked: boolean
}

export interface InlineOverlayActions {
  onHover: (key: string) => void
  onLeave: (key: string) => void
  onSelect: (key: string) => void
}

const INLINE_CSS = `
  :host { all: initial; }
  *, *::before, *::after { box-sizing: border-box; }

  .root {
    position: relative;
    width: 46px;
    height: 46px;
    pointer-events: auto;
    font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }

  .shell {
    position: relative;
    width: 46px;
    height: 46px;
    border-radius: 999px;
    border: 1px solid rgba(249,115,22,0.34);
    background: rgba(12,12,12,0.9);
    box-shadow: 0 6px 16px rgba(0,0,0,0.26);
    cursor: pointer;
    transition: transform 160ms ease, opacity 160ms ease, border-color 160ms ease, box-shadow 160ms ease;
  }

  .shell:hover,
  .shell[data-active="true"],
  .shell[data-selected="true"] {
    transform: translateY(-1px) scale(1.02);
    border-color: rgba(251,146,60,0.62);
    box-shadow: 0 10px 22px rgba(0,0,0,0.34);
  }

  .ring {
    position: absolute;
    inset: 4px;
    border-radius: 999px;
    background: conic-gradient(var(--ring-color, #f97316) calc(var(--ring-pct, 0) * 1%), rgba(148,163,184,0.22) 0);
  }

  .core {
    position: absolute;
    inset: 8px;
    border-radius: 999px;
    background: #0a0a0a;
    border: 1px solid rgba(255,255,255,0.1);
    color: #f5f5f5;
    display: grid;
    place-items: center;
    font-size: 10px;
    font-weight: 760;
    letter-spacing: -0.01em;
    font-variant-numeric: tabular-nums;
  }

  .visa-dot {
    position: absolute;
    right: -2px;
    top: -2px;
    width: 10px;
    height: 10px;
    border-radius: 999px;
    border: 1px solid rgba(10,10,10,0.88);
    background: #6b7280;
    box-shadow: 0 0 0 2px rgba(10,10,10,0.75);
    transition: transform 140ms ease, opacity 140ms ease;
  }

  .visa-dot[data-tier="positive"] { background: #22c55e; }
  .visa-dot[data-tier="warn"] { background: #f97316; }
  .visa-dot[data-tier="neutral"] { background: #94a3b8; }
  .visa-dot[data-tier="none"] {
    opacity: 0;
    transform: scale(0.65);
  }

  .tip {
    position: absolute;
    right: 0;
    top: calc(100% + 4px);
    background: rgba(10,10,10,0.94);
    color: #d1d5db;
    border: 1px solid rgba(148,163,184,0.24);
    border-radius: 7px;
    padding: 2px 5px;
    font-size: 9px;
    white-space: nowrap;
    opacity: 0;
    transform: translateY(4px) scale(0.98);
    pointer-events: none;
    transition: opacity 160ms ease, transform 160ms ease;
    box-shadow: 0 8px 18px rgba(0,0,0,0.32);
  }

  .shell:hover + .tip,
  .shell[data-active="true"] + .tip {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
`

function clampPercent(value: number | null): number {
  if (value == null) return 12
  return Math.max(0, Math.min(100, Math.round(value)))
}

function ringColor(model: InlineOverlayModel): string {
  if (model.primarySignal === "visa") {
    if (model.visaTier === "positive") return "#22c55e"
    if (model.visaTier === "warn") return "#f97316"
    return "#94a3b8"
  }
  if (model.primarySignal === "tailor") return "#fb923c"
  if (model.primarySignal === "queue") return "#38bdf8"
  if (model.primarySignal === "check") return "#9ca3af"
  return "#f97316"
}

export class InlineJobIntelligenceLayer {
  private readonly host: HTMLElement
  private readonly shadow: ShadowRoot
  private readonly root: HTMLElement
  private readonly shell: HTMLButtonElement
  private model: InlineOverlayModel
  private readonly actions: InlineOverlayActions

  constructor(card: JobCardSnapshot, model: InlineOverlayModel, actions: InlineOverlayActions) {
    this.model = model
    this.actions = actions

    this.host = document.createElement("div")
    this.host.className = "ho-inline-job-indicator"
    this.host.dataset.hoKey = model.key
    this.applyPlacement(model.role)

    this.shadow = this.host.attachShadow({ mode: "closed" })
    const style = document.createElement("style")
    style.textContent = INLINE_CSS
    this.shadow.appendChild(style)

    this.root = document.createElement("div")
    this.root.className = "root"
    this.root.innerHTML = `
      <button type="button" class="shell" aria-label="Scout indicator" aria-expanded="false">
        <span class="ring" data-role="ring"></span>
        <span class="core" data-role="core">--</span>
        <span class="visa-dot" data-role="visa" data-tier="none"></span>
      </button>
      <span class="tip" data-role="tip"></span>
    `

    this.shadow.appendChild(this.root)
    this.shell = this.root.querySelector(".shell") as HTMLButtonElement

    this.bindEvents()
    this.ensureAttachedToCard(card.host)
    this.render()
  }

  private applyPlacement(role: OverlayCardRole): void {
    if (role === "detail") {
      this.host.style.position = "relative"
      this.host.style.top = "0"
      this.host.style.right = "0"
      this.host.style.margin = "8px 0 10px auto"
      this.host.style.zIndex = "2"
      return
    }

    this.host.style.position = "absolute"
    this.host.style.top = "8px"
    this.host.style.right = "8px"
    this.host.style.margin = "0"
    this.host.style.zIndex = "5"
  }

  private bindEvents(): void {
    this.shell.addEventListener("mouseenter", () => {
      this.actions.onHover(this.model.key)
    })

    this.shell.addEventListener("mouseleave", () => {
      this.actions.onLeave(this.model.key)
    })

    this.shell.addEventListener("focus", () => {
      this.actions.onHover(this.model.key)
    })

    this.shell.addEventListener("blur", () => {
      this.actions.onLeave(this.model.key)
    })

    this.shell.addEventListener("click", (e) => {
      e.preventDefault()
      e.stopPropagation()
      this.actions.onSelect(this.model.key)
    })

    this.shell.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return
      e.preventDefault()
      e.stopPropagation()
      this.actions.onSelect(this.model.key)
    })
  }

  private ensureAttachedToCard(host: HTMLElement): void {
    if (this.model.role === "result") {
      const style = getComputedStyle(host)
      if (style.position === "static") {
        host.dataset.hoOverlayWasStatic = "1"
        host.style.position = "relative"
      }
    }
    if (!this.host.isConnected || this.host.parentElement !== host) {
      if (this.model.role === "detail") host.prepend(this.host)
      else host.appendChild(this.host)
    }
  }

  private render(): void {
    const ring = this.root.querySelector<HTMLElement>("[data-role='ring']")
    const core = this.root.querySelector<HTMLElement>("[data-role='core']")
    const visa = this.root.querySelector<HTMLElement>("[data-role='visa']")
    const tip = this.root.querySelector<HTMLElement>("[data-role='tip']")

    const pct = clampPercent(this.model.matchPercent)
    if (ring) {
      ring.style.setProperty("--ring-pct", String(pct))
      ring.style.setProperty("--ring-color", ringColor(this.model))
    }
    if (core) core.textContent = this.model.matchLabel
    if (visa) visa.dataset.tier = this.model.visaTier

    this.shell.dataset.active = this.model.active ? "true" : "false"
    this.shell.dataset.selected = this.model.selected ? "true" : "false"
    this.shell.setAttribute("aria-expanded", this.model.active ? "true" : "false")

    if (tip) {
      tip.textContent = this.model.visaTier !== "none"
        ? `${this.model.visaLabel} · match ${this.model.matchLabel}`
        : `Match ${this.model.matchLabel}`
    }
  }

  update(card: JobCardSnapshot, model: InlineOverlayModel): void {
    this.model = model
    this.host.dataset.hoKey = model.key
    this.applyPlacement(model.role)
    this.ensureAttachedToCard(card.host)
    this.render()
  }

  setHidden(hidden: boolean): void {
    this.host.style.display = hidden ? "none" : ""
  }

  focus(): void {
    this.shell.focus({ preventScroll: true })
  }

  anchorRect(): DOMRect {
    return this.shell.getBoundingClientRect()
  }

  destroy(): void {
    const parent = this.host.parentElement
    if (parent && parent.dataset.hoOverlayWasStatic === "1") {
      parent.style.position = ""
      delete parent.dataset.hoOverlayWasStatic
    }
    this.host.remove()
  }
}
