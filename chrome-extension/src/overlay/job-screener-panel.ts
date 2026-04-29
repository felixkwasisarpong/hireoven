import type { OverlaySite, JobCardSnapshot } from "./site-adapters"

export interface ScreenerFilters {
  enabled: boolean
  h1bOnly: boolean
  eVerifyOnly: boolean
  hideNoSponsor: boolean
  hideViewed: boolean
}

export interface ScreenerCardSignals {
  hasH1B: boolean
  hasEVerify: boolean
  hasNoSponsor: boolean
  viewed: boolean
}

const PANEL_STYLE = `
  :host { all: initial; }
  *, *::before, *::after { box-sizing: border-box; }

  .panel {
    display: block;
    margin: 0 0 12px;
    padding: 12px 14px;
    border-radius: 12px;
    border: 1px solid #d1fae5;
    background: linear-gradient(180deg, #ecfdf5 0%, #ffffff 100%);
    color: #0f172a;
    font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    box-shadow: 0 6px 16px rgba(2, 6, 23, 0.04);
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
    width: 24px;
    height: 24px;
    border-radius: 999px;
    background: #10b981;
    color: #052e1f;
    font-size: 12px;
    font-weight: 800;
    flex: 0 0 auto;
  }

  .title {
    flex: 1;
    font-size: 13px;
    font-weight: 760;
  }

  .title small {
    color: #475569;
    font-weight: 500;
    margin-left: 6px;
  }

  .toggle {
    appearance: none;
    width: 32px;
    height: 18px;
    border-radius: 999px;
    background: #cbd5e1;
    position: relative;
    cursor: pointer;
    transition: background 120ms ease;
    flex: 0 0 auto;
  }

  .toggle::after {
    content: "";
    position: absolute;
    top: 2px;
    left: 2px;
    width: 14px;
    height: 14px;
    border-radius: 999px;
    background: #fff;
    transition: transform 140ms ease;
  }

  .toggle:checked { background: #10b981; }
  .toggle:checked::after { transform: translateX(14px); }

  .filters {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 10px;
  }

  .check {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    font-weight: 600;
    color: #1e293b;
    cursor: pointer;
    user-select: none;
  }

  .check input {
    appearance: none;
    width: 14px;
    height: 14px;
    border-radius: 4px;
    border: 1.5px solid #94a3b8;
    background: #ffffff;
    cursor: pointer;
    position: relative;
  }

  .check input:checked {
    background: #10b981;
    border-color: #10b981;
  }

  .check input:checked::after {
    content: "";
    position: absolute;
    top: 1px;
    left: 4px;
    width: 4px;
    height: 8px;
    border: solid #ffffff;
    border-width: 0 2px 2px 0;
    transform: rotate(45deg);
  }
`

interface PanelOptions {
  site: OverlaySite
  initial: ScreenerFilters
  onChange: (filters: ScreenerFilters) => void
}

const ANCHOR_SELECTORS: Record<OverlaySite, string[]> = {
  linkedin: [
    ".jobs-search-results-list",
    ".scaffold-layout__list",
    ".jobs-search__results-list",
    "ul.jobs-search-results__list",
  ],
  glassdoor: [
    "[data-test='joblist']",
    "ul[class*='JobsList_jobsList']",
    "section[class*='JobsList']",
  ],
  indeed: [
    "#mosaic-jobResults",
    "#mosaic-provider-jobcards",
    ".jobsearch-LeftPane",
  ],
  generic: [],
}

export class JobScreenerPanel {
  private readonly host: HTMLElement
  private readonly shadow: ShadowRoot
  private readonly root: HTMLElement
  private filters: ScreenerFilters

  constructor(private readonly options: PanelOptions) {
    this.filters = { ...options.initial }
    this.host = document.createElement("div")
    this.host.id = "hireoven-job-screener"
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

  private render(): void {
    const f = this.filters
    this.root.innerHTML = `
      <div class="head">
        <span class="frog" title="Hireoven">H</span>
        <div class="title">Job Screener<small>Filter visible cards</small></div>
        <input type="checkbox" class="toggle" data-key="enabled" ${f.enabled ? "checked" : ""} aria-label="Enable screener" />
      </div>
      <div class="filters" style="opacity:${f.enabled ? "1" : "0.5"};pointer-events:${f.enabled ? "auto" : "none"}">
        <label class="check"><input type="checkbox" data-key="h1bOnly" ${f.h1bOnly ? "checked" : ""}/>H1B</label>
        <label class="check"><input type="checkbox" data-key="eVerifyOnly" ${f.eVerifyOnly ? "checked" : ""}/>E-Verify</label>
        <label class="check"><input type="checkbox" data-key="hideNoSponsor" ${f.hideNoSponsor ? "checked" : ""}/>Hide "No sponsorship"</label>
        <label class="check"><input type="checkbox" data-key="hideViewed" ${f.hideViewed ? "checked" : ""}/>Hide viewed</label>
      </div>
    `

    this.root.querySelectorAll<HTMLInputElement>("input[type='checkbox'][data-key]").forEach((input) => {
      input.addEventListener("change", () => {
        const key = input.dataset.key as keyof ScreenerFilters
        if (!key) return
        ;(this.filters as unknown as Record<string, boolean>)[key] = input.checked
        this.options.onChange({ ...this.filters })
        this.render()
      })
    })
  }

  setFilters(next: ScreenerFilters): void {
    this.filters = { ...next }
    this.render()
  }

  ensureMounted(): boolean {
    const anchor = this.findAnchor()
    if (!anchor) return false
    if (this.host.parentElement === anchor.parentElement && anchor.previousElementSibling === this.host) return true
    anchor.parentElement?.insertBefore(this.host, anchor)
    return true
  }

  private findAnchor(): HTMLElement | null {
    const selectors = ANCHOR_SELECTORS[this.options.site] ?? []
    for (const selector of selectors) {
      const node = document.querySelector<HTMLElement>(selector)
      if (node) return node
    }
    return null
  }

  destroy(): void {
    this.host.remove()
  }
}

export function applyScreenerFilters(
  filters: ScreenerFilters,
  cardsWithSignals: Array<{ card: JobCardSnapshot; signals: ScreenerCardSignals }>,
): number {
  if (!filters.enabled) {
    for (const { card } of cardsWithSignals) {
      card.host.style.removeProperty("display")
    }
    return cardsWithSignals.length
  }

  let visibleCount = 0
  for (const { card, signals } of cardsWithSignals) {
    let hide = false
    if (filters.h1bOnly && !signals.hasH1B) hide = true
    if (filters.eVerifyOnly && !signals.hasEVerify) hide = true
    if (filters.hideNoSponsor && signals.hasNoSponsor) hide = true
    if (filters.hideViewed && signals.viewed) hide = true

    if (hide) {
      card.host.style.display = "none"
    } else {
      card.host.style.removeProperty("display")
      visibleCount++
    }
  }
  return visibleCount
}
