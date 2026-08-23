import { chromium, type Browser, type BrowserContext, type Page } from "playwright"

/**
 * Live E-Verify employer lookup by driving the USCIS "E-Verify Employer Search"
 * Tableau dashboard (https://www.e-verify.gov/e-verify-employer-search).
 *
 * USCIS removed the bulk download — the only authoritative, daily-refreshed source
 * is this search tool, which has no public API. The dashboard renders to the DOM
 * (browser-rendering mode), so we drive it with Playwright: set the "Date Enrolled"
 * filter to "Last 30 years" (the default is "This year", which hides older enrollees),
 * type a company name into the "Business Name" wildcard filter, and read the
 * resulting "E-Verify Participating Employer List" table back out of the DOM.
 *
 * This is a scraper of a third-party government UI: it is INHERENTLY FRAGILE (any
 * dashboard redesign breaks it) and must be run politely (low concurrency, delays).
 * Callers should treat results conservatively — a false E-Verify flag can harm a
 * student's STEM OPT case, so match exactly and only trust "Open" account status.
 */

const VIZ_URL =
  "https://bigdataanalyticspub-sb.uscis.dhs.gov/views/E-VerifyEmployerSearch_17259895596010/Dashboard?:embed=y&:showVizHome=no"

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

export interface EverifySearchHit {
  employer_name: string
  doing_business_as: string | null
  account_status: string | null // "Open" | "Terminated" | ...
  opted_into_plus: string | null
  date_enrolled: string | null
  workforce_size: string | null
  state: string | null
}

export interface EverifySearchResult {
  query: string
  totalRecordsFiltered: number | null
  hits: EverifySearchHit[]
}

export interface EverifyLookupOptions {
  headless?: boolean
  /** ms to wait after a search before reading the table (table re-render). */
  searchSettleMs?: number
  /** overall navigation timeout in ms. */
  navTimeoutMs?: number
}

const VIEWPORT = { width: 1000, height: 1300 }

export class EverifyTableauLookup {
  private browser: Browser | null = null
  private ctx: BrowserContext | null = null
  private page: Page | null = null
  private readonly opts: Required<EverifyLookupOptions>

  constructor(opts: EverifyLookupOptions = {}) {
    this.opts = {
      headless: opts.headless ?? true,
      searchSettleMs: opts.searchSettleMs ?? 7000,
      navTimeoutMs: opts.navTimeoutMs ?? 60000,
    }
  }

  /** Launch the browser, load the dashboard, and switch Date Enrolled to "Last 30 years". */
  async init(): Promise<void> {
    this.browser = await chromium.launch({ headless: this.opts.headless })
    this.ctx = await this.browser.newContext({ viewport: VIEWPORT, userAgent: UA })
    this.page = await this.ctx.newPage()
    const page = this.page
    await page.goto(VIZ_URL, { waitUntil: "domcontentloaded", timeout: this.opts.navTimeoutMs })
    // The dashboard renders text to the DOM; wait until the "Business Name" filter label exists.
    await page.waitForFunction(
      () => [...document.querySelectorAll("*")].some((e) => e.children.length === 0 && /Business Name/i.test(e.textContent || "")),
      undefined,
      { timeout: this.opts.navTimeoutMs }
    )
    await page.waitForTimeout(3000)
    await this.setDateEnrolledAllData()
  }

  /** Find the bounding rect of the first leaf element whose trimmed text matches `re`. */
  /**
   * The Date Enrolled value control — the box showing the current selection,
   * which opens the relative-date panel when its caret is clicked.
   *
   * Anchored on the control itself rather than a pixel offset from the "Date
   * Enrolled" label. The previous code clicked `label.x + 150`, which broke when
   * USCIS added the "[Select last 30 years for all data]" hint above the row and
   * shifted everything: the click landed on dead space, the panel never opened,
   * and the "Last … years" lookup then failed with a message blaming a layout
   * change that had not actually happened. The panel is unchanged; only the way
   * in moved.
   *
   * Identified by the wide leaf on the same row as the label. Width matters:
   * the descriptive blurb above also contains the words "this year", and
   * matching that instead opens nothing.
   */
  private async dateEnrolledControl(): Promise<{ x: number; y: number; w: number; h: number } | null> {
    return this.page!.evaluate(() => {
      const leaves = [...document.querySelectorAll("*")].filter((e) => e.children.length === 0)
      const label = leaves.find((e) => (e.textContent || "").trim() === "Date Enrolled")
      if (!label) return null
      const lr = label.getBoundingClientRect()
      const candidates = leaves
        .map((e) => ({ el: e, r: e.getBoundingClientRect() }))
        .filter(({ el, r }) =>
          r.width > 100 &&
          r.x > lr.x &&
          Math.abs(r.y - lr.y) < 24 &&
          (el.textContent || "").trim().length > 0,
        )
        .sort((a, b) => b.r.width - a.r.width)
      const best = candidates[0]
      if (!best) return null
      return { x: best.r.x, y: best.r.y, w: best.r.width, h: best.r.height }
    })
  }

  private async leafRect(re: string): Promise<{ x: number; y: number; w: number; h: number } | null> {
    return this.page!.evaluate((src) => {
      const rx = new RegExp(src, "i")
      const el = [...document.querySelectorAll("*")].find((e) => e.children.length === 0 && rx.test((e.textContent || "").trim()))
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: r.x, y: r.y, w: r.width, h: r.height }
    }, re)
  }

  /**
   * Open the "Date Enrolled" relative-date dropdown and select "Last [30] years",
   * which the dashboard documents as "all data". Without this, only employers
   * enrolled in the current calendar year are returned.
   */
  private async setDateEnrolledAllData(): Promise<void> {
    const page = this.page!
    const de = await this.leafRect("Date Enrolled")
    if (!de) throw new Error("E-Verify lookup: could not find 'Date Enrolled' filter")

    const control = await this.dateEnrolledControl()
    if (!control) {
      throw new Error("E-Verify lookup: could not locate the Date Enrolled value control")
    }
    // The caret sits just inside the control's right edge.
    await page.mouse.click(control.x + control.w - 8, control.y + control.h / 2)
    await page.waitForTimeout(2500)

    // "Last [N] years" radio + its number box (just left of the "years" label).
    const last = await this.leafRect("^Last$")
    const years = await page.evaluate(() => {
      const el = [...document.querySelectorAll("*")].find((e) => e.children.length === 0 && (e.textContent || "").trim() === "years")
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: r.x, y: r.y }
    })
    if (!last || !years) throw new Error("E-Verify lookup: Date Enrolled dropdown layout changed (no 'Last … years')")

    await page.mouse.click(last.x - 12, last.y + last.h / 2)
    await page.waitForTimeout(1200)
    await page.mouse.dblclick(years.x - 22, years.y + 7)
    await page.waitForTimeout(300)
    await page.keyboard.press("Control+A")
    await page.keyboard.type("30", { delay: 70 })
    await page.keyboard.press("Enter")
    await page.waitForTimeout(4500)
    // Click away to close the dropdown.
    await page.mouse.click(de.x, Math.max(10, de.y - 50))
    await page.waitForTimeout(2000)
  }

  /** Search the Business Name wildcard filter and read back the employer table. */
  async search(name: string): Promise<EverifySearchResult> {
    const page = this.page!
    const bn = await this.leafRect("Business Name")
    if (!bn) throw new Error("E-Verify lookup: could not find 'Business Name' filter")

    // Clicking the wildcard card focuses a `textarea.QueryBox`. Activation is racy, so
    // click and confirm the textarea is focused before typing; retry a couple of times.
    const focused = async () =>
      page.evaluate(() => {
        const a = document.activeElement as HTMLElement | null
        return !!a && a.tagName === "TEXTAREA" && /QueryBox/.test(a.className)
      })
    let ready = false
    for (let attempt = 0; attempt < 4 && !ready; attempt++) {
      await page.mouse.click(bn.x + 30, bn.y + bn.h + 14)
      await page.waitForTimeout(500)
      ready = await focused()
    }
    if (!ready) throw new Error("E-Verify lookup: could not focus the Business Name search box")

    // Clear any prior query first. "ControlOrMeta+A" maps to Cmd+A on macOS and
    // Ctrl+A elsewhere — a plain Control+A does NOT select-all on macOS, which would
    // leave the previous term in place and concatenate the two (→ no matches).
    await page.keyboard.press("ControlOrMeta+A")
    await page.keyboard.press("Delete")
    await page.keyboard.type(name, { delay: 45 })
    await page.keyboard.press("Enter")
    await page.waitForTimeout(this.opts.searchSettleMs)

    const { hits, total } = await page.evaluate(() => {
      const leaves = [...document.querySelectorAll("span,div,a")].filter((e) => e.children.length === 0 && (e.textContent || "").trim())
      const all = leaves.map((e) => {
        const r = e.getBoundingClientRect()
        return { t: (e.textContent || "").trim(), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width) }
      })

      // "Total Records Filtered: N" — the number renders as a separate nearby cell.
      let total: number | null = null
      const totalLabel = all.find((c) => /Total Records Filtered/i.test(c.t))
      if (totalLabel) {
        const near = all
          .filter((c) => Math.abs(c.y - totalLabel.y) <= 8 && c.x > totalLabel.x && /^[\d,]+$/.test(c.t))
          .sort((a, b) => a.x - b.x)[0]
        if (near) total = Number(near.t.replace(/,/g, ""))
      }

      // The table's column HEADER row is rendered as an image, not DOM text, so we
      // can't read column positions from it. The data cells, however, render as text
      // at stable left-x positions (1000px viewport). Assign each cell to the nearest
      // column anchor. Anchors are >=60px apart, so a 40px tolerance is unambiguous.
      const cols = [
        { key: "lastUpdated", x: 57 },
        { key: "employer", x: 145 },
        { key: "dba", x: 361 },
        { key: "status", x: 441 },
        { key: "plus", x: 501 },
        { key: "enrolled", x: 565 },
        { key: "terminated", x: 645 },
        { key: "workforce", x: 725 },
        { key: "state", x: 797 },
        { key: "sites", x: 860 },
      ]
      const header = [...document.querySelectorAll("*")].find((e) => e.children.length === 0 && /Participating Employer List/i.test(e.textContent || ""))
      if (!header) return { hits: [], total }
      const dataTop = header.getBoundingClientRect().bottom + 40

      // Group data cells into rows by y, then assign each cell to the nearest column by x.
      const dataCells = all.filter((c) => c.y > dataTop && c.x > 10 && c.y < 1150)
      const rows: Array<{ y: number; cells: typeof dataCells }> = []
      for (const c of dataCells.sort((a, b) => a.y - b.y || a.x - b.x)) {
        let row = rows.find((r) => Math.abs(r.y - c.y) <= 6)
        if (!row) {
          row = { y: c.y, cells: [] }
          rows.push(row)
        }
        row.cells.push(c)
      }

      const TOOLBAR = /^(Undo|Redo|Revert|Refresh|Pause|Replay|Download|Full Screen|Share|Replay Speed)/i
      const hits = rows
        .map((row) => {
          const rec: Record<string, string> = {}
          for (const c of row.cells) {
            // nearest column by x-center
            let best: { key: string; x: number } | null = null
            let bestD = Infinity
            for (const col of cols) {
              const d = Math.abs(col.x - c.x)
              if (d < bestD) {
                bestD = d
                best = col
              }
            }
            if (best && bestD <= 40) rec[best.key] = rec[best.key] ? rec[best.key] + " " + c.t : c.t
          }
          return rec
        })
        .filter((rec) => rec.employer && !TOOLBAR.test(rec.employer))
        .map((rec) => ({
          employer_name: rec.employer,
          doing_business_as: rec.dba ?? null,
          account_status: rec.status ?? null,
          opted_into_plus: rec.plus ?? null,
          date_enrolled: rec.enrolled ?? null,
          workforce_size: rec.workforce ?? null,
          state: rec.state ?? null,
        }))

      return { hits, total }
    })

    return { query: name, totalRecordsFiltered: total, hits }
  }

  /** Tear down and relaunch a fresh session. The USCIS Tableau session expires after
   *  roughly an hour, after which the search box stops responding — callers should
   *  recycle periodically and on repeated failures. */
  async reinit(): Promise<void> {
    await this.close()
    await this.init()
  }

  async close(): Promise<void> {
    await this.page?.close().catch(() => {})
    await this.ctx?.close().catch(() => {})
    await this.browser?.close().catch(() => {})
    this.page = this.ctx = this.browser = null
  }
}
