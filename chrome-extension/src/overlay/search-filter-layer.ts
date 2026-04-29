export interface SearchFilterState {
  visaFriendly: boolean
  remoteFirst: boolean
  highResponseLikelihood: boolean
  highSponsorshipProbability: boolean
  highMatch: boolean
  tailorWorthy: boolean
}

export interface SearchFilterCallbacks {
  onChange: (state: SearchFilterState) => void
}

const DEFAULT_STATE: SearchFilterState = {
  visaFriendly: false,
  remoteFirst: false,
  highResponseLikelihood: false,
  highSponsorshipProbability: false,
  highMatch: false,
  tailorWorthy: false,
}

const FILTER_CSS = `
  :host { all: initial; }
  *, *::before, *::after { box-sizing: border-box; }

  .wrap {
    position: fixed;
    top: 12px;
    right: 12px;
    z-index: 2147483645;
    font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }

  .panel {
    width: min(280px, calc(100vw - 24px));
    border-radius: 12px;
    border: 1px solid rgba(249,115,22,0.38);
    background: rgba(15,15,15,0.92);
    box-shadow: 0 12px 26px rgba(0,0,0,0.3);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    overflow: hidden;
    transition: transform 160ms ease, opacity 160ms ease;
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 10px;
    border-bottom: 1px solid rgba(249,115,22,0.22);
  }

  .title {
    font-size: 11px;
    font-weight: 750;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: #fdba74;
  }

  .collapse {
    border: 1px solid rgba(148,163,184,0.32);
    background: rgba(30,41,59,0.6);
    color: #f3f4f6;
    border-radius: 8px;
    min-width: 26px;
    min-height: 24px;
    font-size: 12px;
    cursor: pointer;
  }

  .body {
    max-height: 288px;
    overflow: auto;
    padding: 8px;
    display: grid;
    grid-template-columns: 1fr;
    gap: 6px;
    transition: max-height 160ms ease, padding 160ms ease, opacity 140ms ease;
  }

  .body.collapsed {
    max-height: 0;
    padding-top: 0;
    padding-bottom: 0;
    opacity: 0;
    pointer-events: none;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 28px;
    border: 1px solid rgba(148,163,184,0.22);
    border-radius: 8px;
    padding: 4px 8px;
    background: rgba(30,41,59,0.42);
  }

  .row input {
    margin: 0;
    accent-color: #f97316;
  }

  .row label {
    font-size: 11px;
    color: #e5e7eb;
    font-weight: 600;
    line-height: 1.3;
    cursor: pointer;
  }
`

function row(id: keyof SearchFilterState, label: string): string {
  return `
    <div class="row">
      <input type="checkbox" id="${id}" data-filter="${id}" />
      <label for="${id}">${label}</label>
    </div>
  `
}

export class SearchFilterLayer {
  private readonly host: HTMLElement
  private readonly shadow: ShadowRoot
  private readonly bodyEl: HTMLElement
  private state: SearchFilterState = { ...DEFAULT_STATE }
  private collapsed = true
  private readonly callbacks: SearchFilterCallbacks

  constructor(callbacks: SearchFilterCallbacks) {
    this.callbacks = callbacks

    this.host = document.createElement("div")
    this.host.id = "hireoven-search-filter-layer"
    document.body.appendChild(this.host)

    this.shadow = this.host.attachShadow({ mode: "closed" })

    const style = document.createElement("style")
    style.textContent = FILTER_CSS
    this.shadow.appendChild(style)

    const wrap = document.createElement("div")
    wrap.className = "wrap"
    wrap.innerHTML = `
      <div class="panel" aria-label="Scout filter layer">
        <div class="head">
          <span class="title">Scout Filters</span>
          <button class="collapse" type="button" data-role="collapse" aria-expanded="false">+</button>
        </div>
        <div class="body collapsed" data-role="body">
          ${row("visaFriendly", "Visa-friendly jobs")}
          ${row("remoteFirst", "Remote-first")}
          ${row("highResponseLikelihood", "High response likelihood")}
          ${row("highSponsorshipProbability", "High sponsorship probability")}
          ${row("highMatch", "High match")}
          ${row("tailorWorthy", "Tailor-worthy")}
        </div>
      </div>
    `
    this.shadow.appendChild(wrap)

    this.bodyEl = this.shadow.querySelector("[data-role='body']") as HTMLElement
    this.bindEvents()
    this.render()
  }

  private bindEvents(): void {
    const collapse = this.shadow.querySelector<HTMLButtonElement>("[data-role='collapse']")
    collapse?.addEventListener("click", () => {
      this.collapsed = !this.collapsed
      this.render()
    })

    this.shadow.querySelectorAll<HTMLInputElement>("[data-filter]").forEach((input) => {
      input.addEventListener("change", () => {
        const key = input.dataset.filter as keyof SearchFilterState
        this.state = { ...this.state, [key]: input.checked }
        this.callbacks.onChange({ ...this.state })
      })
    })
  }

  private render(): void {
    const collapse = this.shadow.querySelector<HTMLButtonElement>("[data-role='collapse']")
    if (collapse) {
      collapse.textContent = this.collapsed ? "+" : "-"
      collapse.setAttribute("aria-expanded", this.collapsed ? "false" : "true")
    }
    this.bodyEl.classList.toggle("collapsed", this.collapsed)

    this.shadow.querySelectorAll<HTMLInputElement>("[data-filter]").forEach((input) => {
      const key = input.dataset.filter as keyof SearchFilterState
      input.checked = Boolean(this.state[key])
    })
  }

  setState(next: Partial<SearchFilterState>): void {
    this.state = { ...this.state, ...next }
    this.render()
  }

  getState(): SearchFilterState {
    return { ...this.state }
  }

  setVisible(visible: boolean): void {
    this.host.style.display = visible ? "" : "none"
  }

  destroy(): void {
    this.host.remove()
  }
}
