export interface DockModel {
  title: string
  focused: boolean
  busy: boolean
  compare: boolean
  queuedApply: boolean
  checkVisaLabel: string
}

export interface DockActions {
  onTailor: () => void
  onCheckVisa: () => void
  onAutofill: () => void
  onCompare: () => void
  onQueueApply: () => void
}

const DOCK_CSS = `
  :host { all: initial; }
  *, *::before, *::after { box-sizing: border-box; }

  .wrap {
    position: fixed;
    left: 50%;
    bottom: 14px;
    transform: translateX(-50%);
    z-index: 2147483646;
    pointer-events: auto;
  }

  .dock {
    min-height: 46px;
    border-radius: 14px;
    border: 1px solid rgba(249,115,22,0.34);
    background: rgba(12,12,12,0.84);
    color: #fafafa;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px;
    max-width: calc(100vw - 20px);
    overflow-x: auto;
    backdrop-filter: blur(11px);
    -webkit-backdrop-filter: blur(11px);
    box-shadow: 0 10px 24px rgba(0,0,0,0.3);
    transition: opacity 160ms ease, transform 160ms ease;
  }

  .dock.inactive {
    opacity: 0.18;
    transform: translateY(5px);
  }

  .title {
    margin: 0 7px 0 6px;
    font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: 11px;
    color: #d4d4d4;
    font-weight: 620;
    white-space: nowrap;
    max-width: 230px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .btn {
    border: 1px solid rgba(255,255,255,0.14);
    background: rgba(255,255,255,0.04);
    color: #fafafa;
    min-height: 31px;
    padding: 0 11px;
    border-radius: 8px;
    cursor: pointer;
    font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: 11px;
    font-weight: 670;
    white-space: nowrap;
    transition: border-color 160ms ease, background 160ms ease, opacity 160ms ease;
  }

  .btn:hover {
    border-color: rgba(249,115,22,0.58);
    background: rgba(249,115,22,0.16);
  }

  .btn.primary {
    background: #f97316;
    border-color: #f97316;
    color: #111111;
  }

  .btn.primary:hover {
    background: #fb923c;
    border-color: #fb923c;
  }

  .btn.toggled {
    border-color: rgba(251,146,60,0.7);
    background: rgba(251,146,60,0.28);
    color: #fff7ed;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: default;
  }
`

export class ScoutCommandDock {
  private readonly host: HTMLElement
  private readonly shadow: ShadowRoot
  private readonly wrap: HTMLElement
  private readonly dockEl: HTMLElement
  private model: DockModel
  private readonly actions: DockActions
  private lastActiveTs = Date.now()
  private idleTimer: number | null = null

  private readonly onActivity = (): void => {
    this.lastActiveTs = Date.now()
    this.dockEl.classList.remove("inactive")
  }

  constructor(actions: DockActions, model?: Partial<DockModel>) {
    this.actions = actions
    this.model = {
      title: "Scout",
      focused: false,
      busy: false,
      compare: false,
      queuedApply: false,
      checkVisaLabel: "Check visa",
      ...model,
    }

    this.host = document.createElement("div")
    this.host.id = "hireoven-scout-command-dock"
    document.body.appendChild(this.host)

    this.shadow = this.host.attachShadow({ mode: "closed" })
    const style = document.createElement("style")
    style.textContent = DOCK_CSS
    this.shadow.appendChild(style)

    this.wrap = document.createElement("div")
    this.wrap.className = "wrap"
    this.wrap.innerHTML = `
      <div class="dock" role="toolbar" aria-label="Hireoven Scout command dock">
        <span class="title" data-role="title"></span>
        <button type="button" class="btn" data-action="tailor">Tailor</button>
        <button type="button" class="btn primary" data-action="visa">Check visa</button>
        <button type="button" class="btn" data-action="autofill">Autofill</button>
        <button type="button" class="btn" data-action="compare">Compare</button>
        <button type="button" class="btn" data-action="queue">Queue apply</button>
      </div>
    `

    this.shadow.appendChild(this.wrap)
    this.dockEl = this.wrap.querySelector(".dock") as HTMLElement

    this.bindEvents()
    this.render()
    this.startIdleClock()
  }

  private bindEvents(): void {
    this.wrap.querySelectorAll<HTMLElement>("[data-action]").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.preventDefault()
        e.stopPropagation()
        this.onActivity()
        const action = (e.currentTarget as HTMLElement).dataset.action
        if (action === "tailor") this.actions.onTailor()
        if (action === "visa") this.actions.onCheckVisa()
        if (action === "autofill") this.actions.onAutofill()
        if (action === "compare") this.actions.onCompare()
        if (action === "queue") this.actions.onQueueApply()
      })
    })

    this.dockEl.addEventListener("mouseenter", this.onActivity)
    this.dockEl.addEventListener("mousemove", this.onActivity)
    this.dockEl.addEventListener("focusin", this.onActivity)

    window.addEventListener("mousemove", this.onActivity, { passive: true })
    window.addEventListener("keydown", this.onActivity)
    window.addEventListener("scroll", this.onActivity, { passive: true })
  }

  private startIdleClock(): void {
    this.idleTimer = window.setInterval(() => {
      const idleFor = Date.now() - this.lastActiveTs
      const hovering = this.dockEl.matches(":hover")
      const focused = this.dockEl.contains(document.activeElement)
      if (!hovering && !focused && idleFor > 2400) {
        this.dockEl.classList.add("inactive")
      }
    }, 420)
  }

  private render(): void {
    const title = this.wrap.querySelector<HTMLElement>("[data-role='title']")
    if (title) title.textContent = this.model.title

    const tailorBtn = this.wrap.querySelector<HTMLButtonElement>("[data-action='tailor']")
    const visaBtn = this.wrap.querySelector<HTMLButtonElement>("[data-action='visa']")
    const autofillBtn = this.wrap.querySelector<HTMLButtonElement>("[data-action='autofill']")
    const compareBtn = this.wrap.querySelector<HTMLButtonElement>("[data-action='compare']")
    const queueBtn = this.wrap.querySelector<HTMLButtonElement>("[data-action='queue']")

    if (tailorBtn) tailorBtn.disabled = !this.model.focused || this.model.busy
    if (visaBtn) {
      visaBtn.disabled = !this.model.focused || this.model.busy
      visaBtn.textContent = this.model.busy ? "Checking..." : this.model.checkVisaLabel
    }
    if (autofillBtn) autofillBtn.disabled = !this.model.focused

    if (compareBtn) {
      compareBtn.disabled = !this.model.focused || this.model.busy
      compareBtn.classList.toggle("toggled", this.model.compare)
      compareBtn.textContent = this.model.compare ? "Compared" : "Compare"
    }

    if (queueBtn) {
      queueBtn.disabled = !this.model.focused || this.model.busy
      queueBtn.classList.toggle("toggled", this.model.queuedApply)
      queueBtn.textContent = this.model.queuedApply ? "Queued" : "Queue apply"
    }
  }

  update(model: Partial<DockModel>): void {
    this.model = { ...this.model, ...model }
    this.render()
  }

  destroy(): void {
    if (this.idleTimer) window.clearInterval(this.idleTimer)
    window.removeEventListener("mousemove", this.onActivity)
    window.removeEventListener("keydown", this.onActivity)
    window.removeEventListener("scroll", this.onActivity)
    this.host.remove()
  }
}
