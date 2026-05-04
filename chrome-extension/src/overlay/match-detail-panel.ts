import type { OverlaySite } from "./site-adapters"

export interface MatchDetailModel {
  matchPercent: number | null
  missingSkills: string[]
  sponsorshipLabel: string | null
  loading: boolean
  hasReachableForm: boolean
}

export interface MatchDetailHandlers {
  onMatch: () => void
  onTailor: () => void
  onCover: () => void
  onAutofill: () => void
  onOpenInHireoven: () => void
}

const PANEL_STYLE = `
  :host { all: initial; }
  *, *::before, *::after { box-sizing: border-box; }

  .panel {
    display: block;
    margin: 0 0 12px;
    padding: 14px;
    border-radius: 12px;
    border: 1px solid #e2e8f0;
    background: #ffffff;
    color: #0f172a;
    font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    box-shadow: 0 6px 16px rgba(2, 6, 23, 0.05);
  }

  .head {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 10px;
  }

  .frog {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 999px;
    background: #FF5C18;
    color: #052e1f;
    font-size: 11px;
    font-weight: 800;
    flex: 0 0 auto;
  }

  .head-title {
    flex: 1;
    font-size: 12px;
    font-weight: 760;
    color: #0f172a;
    letter-spacing: 0.01em;
  }

  .head-sub {
    font-size: 10px;
    color: #64748b;
    font-weight: 500;
  }

  .gauge-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 6px 4px 10px;
  }

  .gauge {
    position: relative;
    width: 70px;
    height: 70px;
    flex: 0 0 auto;
  }

  .gauge svg { width: 100%; height: 100%; transform: rotate(-90deg); }
  .gauge .track { fill: none; stroke: #e2e8f0; stroke-width: 8; }
  .gauge .fill { fill: none; stroke: #FF5C18; stroke-width: 8; stroke-linecap: round; transition: stroke-dasharray 240ms ease; }

  .gauge-num {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 16px;
    font-weight: 800;
    color: #0f172a;
  }

  .gauge-text {
    flex: 1;
    min-width: 0;
  }

  .gauge-text .kw {
    font-size: 12px;
    font-weight: 600;
    color: #475569;
    line-height: 1.4;
  }

  .gauge-text .kw a {
    color: #047857;
    font-weight: 700;
    text-decoration: underline;
    cursor: pointer;
  }

  .kw-row {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 4px;
  }

  .kw-pill {
    display: inline-flex;
    align-items: center;
    height: 18px;
    padding: 0 7px;
    border-radius: 999px;
    background: #fef2f2;
    color: #b91c1c;
    border: 1px solid #fecaca;
    font-size: 10px;
    font-weight: 700;
  }

  .kw-more {
    display: inline-flex;
    align-items: center;
    height: 18px;
    padding: 0 6px;
    border-radius: 999px;
    background: #f1f5f9;
    color: #475569;
    font-size: 10px;
    font-weight: 700;
  }

  .visa-pill {
    display: inline-flex;
    margin-top: 8px;
    align-items: center;
    gap: 4px;
    padding: 3px 9px;
    border-radius: 999px;
    background: #eff6ff;
    color: #1d4ed8;
    border: 1px solid #bfdbfe;
    font-size: 10px;
    font-weight: 700;
  }

  .actions-row {
    display: flex;
    gap: 6px;
    background: #0b1220;
    border-radius: 999px;
    padding: 6px;
    margin-top: 4px;
  }

  .actions-row button {
    flex: 1;
    height: 32px;
    border-radius: 999px;
    border: none;
    background: transparent;
    color: #f8fafc;
    font-size: 11px;
    font-weight: 700;
    cursor: pointer;
    white-space: nowrap;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
  }

  .actions-row button.primary {
    background: #FF5C18;
    color: #052e1f;
  }

  .actions-row button:hover { background: rgba(255,255,255,0.1); }
  .actions-row button.primary:hover { background: #34d399; }
  .actions-row button:disabled { opacity: 0.55; cursor: default; }

  .skeleton {
    height: 14px;
    border-radius: 6px;
    background: linear-gradient(90deg, #e2e8f0 25%, #f1f5f9 37%, #e2e8f0 63%);
    background-size: 400% 100%;
    animation: ho-skel 1.4s linear infinite;
  }

  @keyframes ho-skel {
    0% { background-position: 100% 50%; }
    100% { background-position: 0 50%; }
  }
`

const ANCHOR_SELECTORS: Record<OverlaySite, string[]> = {
  linkedin: [
    ".jobs-search__job-details--container",
    ".jobs-details__main-content",
    ".job-view-layout",
    ".scaffold-layout__detail",
  ],
  glassdoor: [
    "[data-test='jobDetails']",
    "[class*='JobDetails_jobDetailsContainer']",
    "div[class*='TwoColumnLayout_columnLeft']",
  ],
  indeed: [
    ".jobsearch-RightPane",
    ".jobsearch-ViewJobLayout-content",
    "#jobsearch-ViewJobButtons-container",
  ],
  handshake: [
    "[data-hook='job-detail']",
    "[class*='job-detail']",
    "main",
  ],
  google_jobs: [
    "div[class*='sY2dNd']",
    "div[class*='vac20e']",
  ],
  generic: [],
}

const TOP_INSERT_TARGETS: Record<OverlaySite, string[]> = {
  linkedin: [
    ".jobs-unified-top-card",
    ".job-details-jobs-unified-top-card",
    ".jobs-details-top-card",
  ],
  glassdoor: [
    "[data-test='jobDetailsHeader']",
    "[class*='JobDetailsHeader']",
  ],
  indeed: [
    ".jobsearch-JobInfoHeader-title-container",
    ".jobsearch-DesktopStickyContainer",
  ],
  handshake: [
    "[data-hook='job-title']",
    "[class*='job-header']",
  ],
  google_jobs: [],
  generic: [],
}

export class MatchDetailPanel {
  private readonly host: HTMLElement
  private readonly shadow: ShadowRoot
  private readonly root: HTMLElement
  private model: MatchDetailModel = {
    matchPercent: null,
    missingSkills: [],
    sponsorshipLabel: null,
    loading: false,
    hasReachableForm: false,
  }

  constructor(private readonly site: OverlaySite, private readonly handlers: MatchDetailHandlers) {
    this.host = document.createElement("div")
    this.host.id = "hireoven-match-detail"
    this.host.style.cssText = "all:initial;display:block;width:100%;"

    this.shadow = this.host.attachShadow({ mode: "closed" })
    const style = document.createElement("style")
    style.textContent = PANEL_STYLE
    this.shadow.appendChild(style)

    this.root = document.createElement("div")
    this.root.className = "panel"
    this.shadow.appendChild(this.root)

    this.render()
  }

  update(model: MatchDetailModel): void {
    this.model = { ...model }
    this.render()
  }

  ensureMounted(): boolean {
    const target = this.findInsertTarget()
    if (!target) return false

    if (this.host.parentElement === target.parent) {
      if (target.before) {
        if (target.before.previousElementSibling === this.host) return true
        target.parent.insertBefore(this.host, target.before)
      } else {
        if (target.parent.lastElementChild === this.host) return true
        target.parent.appendChild(this.host)
      }
      return true
    }

    if (target.before) {
      target.parent.insertBefore(this.host, target.before)
    } else {
      target.parent.appendChild(this.host)
    }
    return true
  }

  private findInsertTarget(): { parent: HTMLElement; before: Element | null } | null {
    for (const selector of TOP_INSERT_TARGETS[this.site] ?? []) {
      const node = document.querySelector<HTMLElement>(selector)
      if (node?.parentElement) {
        return { parent: node.parentElement, before: node.nextElementSibling }
      }
    }
    for (const selector of ANCHOR_SELECTORS[this.site] ?? []) {
      const node = document.querySelector<HTMLElement>(selector)
      if (node) return { parent: node, before: node.firstElementChild }
    }
    return null
  }

  private render(): void {
    const m = this.model
    const pct = m.matchPercent == null ? null : Math.max(0, Math.min(100, Math.round(m.matchPercent)))
    const circumference = 2 * Math.PI * 28
    const dash = pct == null ? 0 : (pct / 100) * circumference
    const missingCount = m.missingSkills.length
    const missingPreview = m.missingSkills.slice(0, 3).map((s) => `<span class="kw-pill">${escape(s)}</span>`).join("")
    const kwLine = pct == null
      ? `Run match to see resume coverage and missing skills.`
      : missingCount === 0
        ? `Strong coverage — no missing skills detected.`
        : `<strong>${missingCount}</strong> missing skill${missingCount === 1 ? "" : "s"} in your resume.${missingPreview ? ` <span class="kw-row">${missingPreview}${missingCount > 3 ? `<span class="kw-more">+${missingCount - 3}</span>` : ""}</span>` : ""}`

    this.root.innerHTML = `
      <div class="head">
        <span class="frog">H</span>
        <div class="head-title">Hireoven Insights<div class="head-sub">${this.site === "indeed" ? "Indeed" : this.site === "glassdoor" ? "Glassdoor" : "LinkedIn"}</div></div>
      </div>
      <div class="gauge-row">
        <div class="gauge" aria-label="Match score">
          <svg viewBox="0 0 64 64" aria-hidden="true">
            <circle class="track" cx="32" cy="32" r="28"></circle>
            <circle class="fill" cx="32" cy="32" r="28" stroke-dasharray="${dash} ${circumference}"></circle>
          </svg>
          <div class="gauge-num">${pct == null ? (m.loading ? "..." : "—") : `${pct}%`}</div>
        </div>
        <div class="gauge-text">
          <div class="kw">${m.loading && pct == null ? `<div class="skeleton"></div>` : kwLine}</div>
          ${m.sponsorshipLabel ? `<span class="visa-pill">${escape(m.sponsorshipLabel)}</span>` : ""}
        </div>
      </div>
      <div class="actions-row" role="toolbar">
        <button class="primary" data-action="match" ${m.loading ? "disabled" : ""}>${m.loading ? "Matching" : pct == null ? "Match" : "Re-match"}</button>
        <button data-action="tailor">Tailor</button>
        <button data-action="cover">Cover Letter</button>
        ${m.hasReachableForm ? `<button data-action="autofill">Autofill</button>` : `<button data-action="open">Open</button>`}
      </div>
    `

    this.root.querySelectorAll<HTMLElement>("[data-action]").forEach((node) => {
      node.addEventListener("click", (event) => {
        event.preventDefault()
        event.stopPropagation()
        const action = node.dataset.action
        switch (action) {
          case "match":
            this.handlers.onMatch()
            return
          case "tailor":
            this.handlers.onTailor()
            return
          case "cover":
            this.handlers.onCover()
            return
          case "autofill":
            this.handlers.onAutofill()
            return
          case "open":
            this.handlers.onOpenInHireoven()
            return
        }
      })
    })
  }

  destroy(): void {
    this.host.remove()
  }
}

function escape(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
}
