import type { OverlayCardRole } from "./site-adapters"

export interface FocusedIntelligenceModel {
  key: string
  role: OverlayCardRole
  title: string
  company: string | null
  matchLabel: string
  visaLabel: string
  whyItMatters: string
  recommendation: string
  matchedSkills: string[]
  missingSkills: string[]
  matchedOverflow: number
  missingOverflow: number
  busy: boolean
  checked: boolean
  compare: boolean
  queuedApply: boolean
}

export interface FocusedIntelligenceActions {
  onRunCheck: (key: string) => void
  onTailor: (key: string) => void
  onCompare: (key: string) => void
  onQueueApply: (key: string) => void
  onAutofill: (key: string) => void
  onCheckVisa: (key: string) => void
  onClose: () => void
  onPanelHoverChange: (hovering: boolean) => void
}

const PANEL_CSS = `
  :host { all: initial; }
  *, *::before, *::after { box-sizing: border-box; }

  .root {
    position: fixed;
    inset: 0;
    z-index: 2147483644;
    pointer-events: none;
    font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }

  .panel {
    pointer-events: auto;
    position: fixed;
    width: 322px;
    max-width: calc(100vw - 18px);
    border-radius: 14px;
    border: 1px solid rgba(249,115,22,0.35);
    background: rgba(12,12,12,0.94);
    color: #f5f5f5;
    box-shadow: 0 16px 34px rgba(0,0,0,0.36);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    opacity: 0;
    transform: translateY(8px) scale(0.98);
    transition: opacity 160ms ease, transform 160ms ease;
    overflow: hidden;
  }

  .panel[data-open="true"] {
    opacity: 1;
    transform: translateY(0) scale(1);
  }

  .panel[data-mode="popover"] {
    right: 16px;
    top: 110px;
  }

  .panel[data-mode="sheet"] {
    right: 16px;
    top: 96px;
    max-height: calc(100vh - 116px);
    display: flex;
    flex-direction: column;
  }

  .head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 10px;
    padding: 10px 12px 9px;
    border-bottom: 1px solid rgba(249,115,22,0.2);
  }

  .meta {
    min-width: 0;
  }

  .kicker {
    font-size: 9px;
    font-weight: 780;
    color: #fdba74;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    margin-bottom: 4px;
  }

  .title {
    font-size: 13px;
    font-weight: 760;
    color: #fafafa;
    line-height: 1.3;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .sub {
    margin-top: 2px;
    font-size: 11px;
    color: #cbd5e1;
  }

  .close {
    flex-shrink: 0;
    width: 26px;
    height: 26px;
    border-radius: 8px;
    border: 1px solid rgba(148,163,184,0.3);
    background: rgba(30,41,59,0.58);
    color: #e2e8f0;
    cursor: pointer;
    line-height: 1;
    font-size: 14px;
  }

  .body {
    padding: 10px 12px 12px;
  }

  .panel[data-mode="sheet"] .body {
    overflow: auto;
    max-height: calc(100vh - 196px);
  }

  .line {
    font-size: 11px;
    line-height: 1.42;
    color: #d1d5db;
    margin-bottom: 8px;
  }

  .pair {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    margin-bottom: 8px;
  }

  .chip {
    font-size: 10px;
    font-weight: 700;
    border-radius: 999px;
    border: 1px solid rgba(148,163,184,0.28);
    background: rgba(30,41,59,0.45);
    color: #e2e8f0;
    padding: 2px 7px;
  }

  .chip.match {
    color: #86efac;
    border-color: rgba(74,222,128,0.35);
    background: rgba(20,83,45,0.45);
  }

  .chip.miss {
    color: #fdba74;
    border-color: rgba(251,146,60,0.4);
    background: rgba(124,45,18,0.38);
  }

  .chip.overflow {
    color: #cbd5e1;
  }

  .sec-label {
    font-size: 9.5px;
    font-weight: 760;
    color: #fbbf24;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin-bottom: 5px;
  }

  .actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
    margin-top: 10px;
  }

  .btn {
    min-height: 30px;
    border-radius: 9px;
    border: 1px solid rgba(148,163,184,0.24);
    background: rgba(31,41,55,0.42);
    color: #e5e7eb;
    font-size: 11px;
    font-weight: 680;
    cursor: pointer;
    transition: background 160ms ease, border-color 160ms ease, opacity 160ms ease;
  }

  .btn:hover {
    border-color: rgba(251,146,60,0.62);
    background: rgba(249,115,22,0.2);
  }

  .btn.primary {
    border-color: #f97316;
    background: #f97316;
    color: #111111;
  }

  .btn.primary:hover { background: #fb923c; border-color: #fb923c; }

  .btn.toggled {
    border-color: rgba(251,146,60,0.62);
    background: rgba(249,115,22,0.34);
    color: #ffedd5;
  }

  .btn:disabled {
    opacity: 0.56;
    cursor: default;
  }
`

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
}

function renderSkillChips(kind: "match" | "miss", values: string[], overflow: number): string {
  if (values.length === 0 && overflow <= 0) {
    return `<span class="chip">${kind === "match" ? "No clear matches yet" : "No key gaps surfaced"}</span>`
  }

  const prefix = kind === "match" ? "\u2713" : "+"
  const chips = values.map((value) => `<span class="chip ${kind}">${prefix} ${esc(value)}</span>`)
  if (overflow > 0) chips.push(`<span class="chip overflow">+${overflow} more</span>`)
  return chips.join("")
}

export class FocusedIntelligenceLayer {
  private readonly host: HTMLElement
  private readonly shadow: ShadowRoot
  private readonly root: HTMLElement
  private readonly panel: HTMLElement
  private model: FocusedIntelligenceModel | null = null
  private readonly actions: FocusedIntelligenceActions

  constructor(actions: FocusedIntelligenceActions) {
    this.actions = actions

    this.host = document.createElement("div")
    this.host.id = "hireoven-focused-intelligence-layer"
    document.body.appendChild(this.host)

    this.shadow = this.host.attachShadow({ mode: "closed" })
    const style = document.createElement("style")
    style.textContent = PANEL_CSS
    this.shadow.appendChild(style)

    this.root = document.createElement("div")
    this.root.className = "root"
    this.root.innerHTML = `
      <section class="panel" data-open="false" data-mode="popover" aria-label="Scout focused intelligence panel">
        <header class="head">
          <div class="meta">
            <div class="kicker" data-role="kicker">Focused Intelligence</div>
            <div class="title" data-role="title">Scout</div>
            <div class="sub" data-role="sub"></div>
          </div>
          <button type="button" class="close" data-action="close" aria-label="Close">×</button>
        </header>
        <div class="body" data-role="body"></div>
      </section>
    `

    this.shadow.appendChild(this.root)
    this.panel = this.root.querySelector(".panel") as HTMLElement

    this.bindEvents()
    this.panel.addEventListener("mouseenter", () => this.actions.onPanelHoverChange(true))
    this.panel.addEventListener("mouseleave", () => this.actions.onPanelHoverChange(false))
  }

  private bindEvents(): void {
    this.root.addEventListener("click", (e) => {
      const t = e.target as HTMLElement | null
      const btn = t?.closest?.("[data-action]") as HTMLElement | null
      if (!btn || !this.model) return

      const action = btn.dataset.action
      if (action === "close") {
        this.actions.onClose()
        return
      }
      if (action === "run-check") this.actions.onRunCheck(this.model.key)
      if (action === "tailor") this.actions.onTailor(this.model.key)
      if (action === "compare") this.actions.onCompare(this.model.key)
      if (action === "queue") this.actions.onQueueApply(this.model.key)
      if (action === "autofill") this.actions.onAutofill(this.model.key)
      if (action === "visa") this.actions.onCheckVisa(this.model.key)
    })
  }

  show(model: FocusedIntelligenceModel, anchor: DOMRect | null): void {
    this.model = model

    const mode = model.role === "detail" ? "sheet" : "popover"
    this.panel.dataset.mode = mode

    const titleEl = this.root.querySelector<HTMLElement>("[data-role='title']")
    const subEl = this.root.querySelector<HTMLElement>("[data-role='sub']")
    const kickerEl = this.root.querySelector<HTMLElement>("[data-role='kicker']")
    const bodyEl = this.root.querySelector<HTMLElement>("[data-role='body']")

    if (titleEl) titleEl.textContent = model.title || "Scout"
    if (subEl) subEl.textContent = `${model.matchLabel} match · ${model.visaLabel}${model.company ? ` · ${model.company}` : ""}`
    if (kickerEl) kickerEl.textContent = mode === "sheet" ? "Opened Job Intelligence" : "Focused Intelligence"

    if (bodyEl) {
      bodyEl.innerHTML = `
        <p class="line">${esc(model.whyItMatters || model.recommendation)}</p>
        <div class="sec-label">Matched Skills</div>
        <div class="pair">${renderSkillChips("match", model.matchedSkills, model.matchedOverflow)}</div>
        <div class="sec-label">Missing Skills</div>
        <div class="pair">${renderSkillChips("miss", model.missingSkills, model.missingOverflow)}</div>
        <div class="actions">
          <button type="button" class="btn primary" data-action="run-check">${model.busy ? "Checking..." : model.checked ? "Refresh check" : "Run check"}</button>
          <button type="button" class="btn" data-action="visa">Check visa</button>
          <button type="button" class="btn" data-action="tailor">Tailor</button>
          <button type="button" class="btn ${model.compare ? "toggled" : ""}" data-action="compare">${model.compare ? "Compared" : "Compare"}</button>
          <button type="button" class="btn" data-action="autofill">Autofill</button>
          <button type="button" class="btn ${model.queuedApply ? "toggled" : ""}" data-action="queue">${model.queuedApply ? "Queued" : "Queue apply"}</button>
        </div>
      `
    }

    if (mode === "popover") {
      const width = 322
      const margin = 12
      const panelH = 292
      const rect = anchor ?? new DOMRect(window.innerWidth - width - margin, 100, 42, 42)
      let left = rect.right + 10
      if (left + width > window.innerWidth - margin) {
        left = rect.left - width - 10
      }
      left = Math.max(margin, Math.min(left, window.innerWidth - width - margin))

      let top = rect.top - 4
      top = Math.max(margin, Math.min(top, window.innerHeight - panelH - margin))

      this.panel.style.left = `${Math.round(left)}px`
      this.panel.style.top = `${Math.round(top)}px`
      this.panel.style.right = "auto"
    } else {
      this.panel.style.left = "auto"
      this.panel.style.top = "96px"
      this.panel.style.right = "16px"
    }

    this.panel.dataset.open = "true"
  }

  hide(): void {
    this.model = null
    this.panel.dataset.open = "false"
  }

  destroy(): void {
    this.host.remove()
  }
}
