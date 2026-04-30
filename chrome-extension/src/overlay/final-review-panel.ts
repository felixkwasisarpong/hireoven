/**
 * Final Review Panel — Chrome extension overlay
 *
 * Shown on application form pages before the user submits manually.
 * Renders a side drawer with readiness checklist, submit button highlight,
 * and "Mark submitted manually" action.
 *
 * Safety rules (enforced, not UI hints):
 *   - NEVER clicks submit programmatically
 *   - NEVER auto-fills fields after this panel opens
 *   - NEVER stores sensitive field values
 */

import type { AutofillIntelligenceResult } from "../autofill/intelligence"

// ── Types ─────────────────────────────────────────────────────────────────────

export type ReviewReadiness = "ready" | "needs_review" | "blocked"

export type ReviewPanelState = {
  jobId?:                string
  jobTitle?:             string | null
  company?:              string | null
  applyUrl:              string
  autofill?:             AutofillIntelligenceResult
  resumeReady?:          boolean
  coverLetterReady?:     boolean
  sensitiveAcknowledged: boolean
  readiness:             ReviewReadiness
  blockers:              string[]
  warnings:              string[]
}

// ── Submit button highlight ───────────────────────────────────────────────────

const SUBMIT_HIGHLIGHT_CLASS = "ho-submit-highlight"

const SUBMIT_BUTTON_SELECTORS = [
  'button[type="submit"]',
  'input[type="submit"]',
  'button[data-qa="btn-submit"]',           // Lever
  'button[aria-label*="submit" i]',
  'button[aria-label*="apply" i]',
  '[data-automation-id*="bottom-navigation-next-button"]', // Workday
  'button[data-testid*="submit"]',
  'button[data-testid*="apply"]',
]

const SUBMIT_HIGHLIGHT_CSS = `
.ho-submit-highlight {
  outline: 2.5px solid #10b981 !important;
  outline-offset: 3px !important;
  box-shadow: 0 0 0 4px rgba(16,185,129,0.18) !important;
  animation: ho-submit-pulse 1.8s ease-in-out infinite !important;
  position: relative;
}
@keyframes ho-submit-pulse {
  0%, 100% { box-shadow: 0 0 0 4px rgba(16,185,129,0.18); }
  50%       { box-shadow: 0 0 0 8px rgba(16,185,129,0.06); }
}
`

function injectSubmitHighlightStyle(): void {
  if (document.getElementById("ho-submit-highlight-style")) return
  const style = document.createElement("style")
  style.id = "ho-submit-highlight-style"
  style.textContent = SUBMIT_HIGHLIGHT_CSS
  document.head.appendChild(style)
}

function highlightSubmitButton(): HTMLElement | null {
  injectSubmitHighlightStyle()
  for (const sel of SUBMIT_BUTTON_SELECTORS) {
    const el = document.querySelector<HTMLElement>(sel)
    if (el) {
      el.classList.add(SUBMIT_HIGHLIGHT_CLASS)
      el.scrollIntoView({ behavior: "smooth", block: "nearest" })
      return el
    }
  }
  return null
}

function clearSubmitHighlight(): void {
  document.querySelectorAll(`.${SUBMIT_HIGHLIGHT_CLASS}`).forEach((el) => {
    el.classList.remove(SUBMIT_HIGHLIGHT_CLASS)
  })
}

// ── Readiness computation ─────────────────────────────────────────────────────

function computePanelReadiness(state: Omit<ReviewPanelState, "readiness" | "blockers" | "warnings">): {
  readiness: ReviewReadiness
  blockers:  string[]
  warnings:  string[]
} {
  const blockers: string[] = []
  const warnings: string[] = []

  if (!state.autofill) {
    warnings.push("Autofill data not loaded — open autofill drawer first.")
  } else {
    const c = state.autofill.counts
    if (c.unsupported > 0) {
      blockers.push(`${c.unsupported} field${c.unsupported !== 1 ? "s" : ""} require manual input (file upload or unknown type).`)
    }
    if (c.sensitive > 0 && !state.sensitiveAcknowledged) {
      warnings.push(`${c.sensitive} sensitive field${c.sensitive !== 1 ? "s" : ""} (sponsorship/legal/EEO) must be answered manually.`)
    }
    if (c.missing > 0) {
      warnings.push(`${c.missing} field${c.missing !== 1 ? "s" : ""} could not be pre-filled.`)
    }
    if (c.review > 0) {
      warnings.push(`${c.review} field${c.review !== 1 ? "s" : ""} need manual review.`)
    }
  }

  let readiness: ReviewReadiness
  if (blockers.length > 0) readiness = "blocked"
  else if (warnings.length > 0 || !state.sensitiveAcknowledged) readiness = "needs_review"
  else readiness = "ready"

  return { readiness, blockers, warnings }
}

// ── Panel rendering ───────────────────────────────────────────────────────────

const PANEL_ID = "ho-final-review-panel"
const OVERLAY_ID = "ho-final-review-overlay"

const READINESS_COLOR: Record<ReviewReadiness, string> = {
  ready:        "#10b981",
  needs_review: "#f59e0b",
  blocked:      "#ef4444",
}
const READINESS_LABEL: Record<ReviewReadiness, string> = {
  ready:        "Ready to apply",
  needs_review: "Needs review",
  blocked:      "Blocked",
}

function buildPanelHTML(state: ReviewPanelState, appOrigin: string): string {
  const { readiness, blockers, warnings, jobTitle, company } = state
  const color = READINESS_COLOR[readiness]
  const label = READINESS_LABEL[readiness]

  const blockersHtml = blockers.map((b) => `
    <div style="display:flex;align-items:flex-start;gap:8px;background:#fef2f2;border-radius:8px;padding:10px 12px;font-size:12px;color:#b91c1c;margin-bottom:6px;">
      <span style="flex-shrink:0;margin-top:1px;">✗</span>
      <span style="line-height:1.5;">${b}</span>
    </div>`).join("")

  const warningsHtml = warnings.map((w) => `
    <div style="display:flex;align-items:flex-start;gap:8px;background:#fffbeb;border-radius:8px;padding:10px 12px;font-size:12px;color:#92400e;margin-bottom:6px;">
      <span style="flex-shrink:0;margin-top:1px;">⚠</span>
      <span style="line-height:1.5;">${w}</span>
    </div>`).join("")

  const autofillCounts = state.autofill?.counts
  const countBadges = autofillCounts ? `
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;">
      ${autofillCounts.ready > 0   ? `<span style="background:#f0fdf4;color:#166534;border-radius:6px;padding:2px 8px;font-size:11px;font-weight:600;">${autofillCounts.ready} ready</span>` : ""}
      ${autofillCounts.review > 0  ? `<span style="background:#fffbeb;color:#92400e;border-radius:6px;padding:2px 8px;font-size:11px;font-weight:600;">${autofillCounts.review} review</span>` : ""}
      ${autofillCounts.missing > 0 ? `<span style="background:#f1f5f9;color:#475569;border-radius:6px;padding:2px 8px;font-size:11px;font-weight:600;">${autofillCounts.missing} missing</span>` : ""}
      ${autofillCounts.sensitive > 0 ? `<span style="background:#fef3c7;color:#92400e;border-radius:6px;padding:2px 8px;font-size:11px;font-weight:600;">${autofillCounts.sensitive} sensitive</span>` : ""}
    </div>` : ""

  const sensitiveBtn = !state.sensitiveAcknowledged ? `
    <button id="ho-ack-sensitive" style="width:100%;background:#fffbeb;border:1px solid #fcd34d;border-radius:10px;padding:10px 14px;text-align:left;cursor:pointer;margin-bottom:10px;">
      <div style="font-size:12px;font-weight:600;color:#92400e;">I have reviewed sensitive questions</div>
      <div style="font-size:11px;color:#b45309;margin-top:2px;">Tap to confirm sponsorship, legal &amp; EEO fields checked</div>
    </button>` : `
    <div style="display:flex;align-items:center;gap:8px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:10px 14px;margin-bottom:10px;">
      <span style="color:#16a34a;font-size:14px;">✓</span>
      <span style="font-size:12px;font-weight:600;color:#166534;">Sensitive fields confirmed</span>
    </div>`

  const dashboardUrl = `${appOrigin}/dashboard/jobs/${state.jobId ?? ""}`

  return `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">

  <!-- Header -->
  <div style="display:flex;align-items:flex-start;justify-content:space-between;border-bottom:1px solid #f1f5f9;padding:14px 16px;">
    <div style="min-width:0;flex:1;">
      <div style="font-size:10px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:#94a3b8;margin-bottom:2px;">Final Review</div>
      <div style="font-size:14px;font-weight:700;color:#0f172a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${jobTitle ?? "Application"}</div>
      ${company ? `<div style="font-size:12px;color:#64748b;">${company}</div>` : ""}
    </div>
    <button id="ho-review-close" style="background:none;border:none;cursor:pointer;padding:4px;color:#94a3b8;border-radius:6px;flex-shrink:0;margin-left:8px;">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1 1l12 12M13 1L1 13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
    </button>
  </div>

  <!-- Readiness badge -->
  <div style="margin:14px 16px 0;">
    <div style="display:flex;align-items:center;gap:8px;border-radius:10px;border:1.5px solid ${color}22;background:${color}11;padding:10px 14px;">
      <div style="width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0;"></div>
      <span style="font-size:13px;font-weight:700;color:${color};">${label}</span>
    </div>
  </div>

  <!-- Scrollable body -->
  <div style="flex:1;overflow-y:auto;padding:14px 16px;display:flex;flex-direction:column;gap:8px;">

    ${blockersHtml}
    ${warningsHtml}
    ${countBadges}
    ${sensitiveBtn}

    <!-- Submit reminder -->
    <div style="display:flex;align-items:flex-start;gap:8px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:10px 12px;">
      <span style="font-size:13px;flex-shrink:0;">🚫</span>
      <div style="font-size:11px;color:#64748b;line-height:1.5;">
        Review the form carefully, then <strong style="color:#1e293b;">submit manually on this page</strong>.
        Scout will never click submit for you.
      </div>
    </div>

    <!-- Open autofill -->
    <button id="ho-open-autofill" style="width:100%;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:10px 14px;font-size:12px;font-weight:600;color:#334155;cursor:pointer;display:flex;align-items:center;gap:8px;">
      ⚡ Open autofill fields
    </button>

    <!-- Open on dashboard -->
    <a href="${dashboardUrl}" target="_blank" rel="noopener noreferrer" style="display:flex;align-items:center;gap:8px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:10px 14px;font-size:12px;font-weight:600;color:#334155;text-decoration:none;">
      📋 Review in Hireoven
    </a>
  </div>

  <!-- Footer -->
  <div style="border-top:1px solid #f1f5f9;padding:12px 16px;display:flex;gap:8px;">
    <button id="ho-mark-submitted" style="flex:1;background:#0f172a;border:none;border-radius:10px;padding:9px 12px;font-size:12px;font-weight:600;color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;">
      ✓ Mark submitted
    </button>
    <button id="ho-review-skip" style="flex:1;background:none;border:1px solid #e2e8f0;border-radius:10px;padding:9px 12px;font-size:12px;font-weight:600;color:#64748b;cursor:pointer;">
      Skip
    </button>
  </div>
</div>`
}

// ── FinalReviewPanel class ────────────────────────────────────────────────────

export class FinalReviewPanel {
  private state: ReviewPanelState
  private appOrigin: string
  private onOpenAutofill: () => void
  private onMarkSubmitted: (jobId?: string) => Promise<void>
  private onClose: () => void

  constructor(opts: {
    initialState:    Omit<ReviewPanelState, "readiness" | "blockers" | "warnings">
    appOrigin:       string
    onOpenAutofill:  () => void
    onMarkSubmitted: (jobId?: string) => Promise<void>
    onClose:         () => void
  }) {
    const { readiness, blockers, warnings } = computePanelReadiness(opts.initialState)
    this.state = { ...opts.initialState, readiness, blockers, warnings }
    this.appOrigin = opts.appOrigin
    this.onOpenAutofill = opts.onOpenAutofill
    this.onMarkSubmitted = opts.onMarkSubmitted
    this.onClose = opts.onClose
  }

  mount(): void {
    this.unmount()

    // Overlay (backdrop)
    const overlay = document.createElement("div")
    overlay.id = OVERLAY_ID
    overlay.style.cssText = `
      position:fixed;top:0;left:0;right:0;bottom:0;z-index:2147483646;
      background:rgba(15,23,42,0.25);backdrop-filter:blur(2px);`
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) this.onClose()
    })

    // Panel
    const panel = document.createElement("div")
    panel.id = PANEL_ID
    panel.style.cssText = `
      position:fixed;top:0;right:0;bottom:0;width:340px;max-width:100vw;
      background:#fff;box-shadow:-4px 0 32px rgba(15,23,42,0.18);
      z-index:2147483647;display:flex;flex-direction:column;
      overflow:hidden;border-left:1px solid #e2e8f0;`
    panel.innerHTML = buildPanelHTML(this.state, this.appOrigin)

    overlay.appendChild(panel)
    document.body.appendChild(overlay)

    this.bindEvents()
    highlightSubmitButton()
  }

  private updateHTML(): void {
    const panel = document.getElementById(PANEL_ID)
    if (!panel) return
    panel.innerHTML = buildPanelHTML(this.state, this.appOrigin)
    this.bindEvents()
  }

  private setState(patch: Partial<ReviewPanelState>): void {
    const merged = { ...this.state, ...patch }
    const { readiness, blockers, warnings } = computePanelReadiness(merged)
    this.state = { ...merged, readiness, blockers, warnings }
    this.updateHTML()
  }

  private bindEvents(): void {
    document.getElementById("ho-review-close")?.addEventListener("click", () => {
      this.onClose()
    })
    document.getElementById("ho-open-autofill")?.addEventListener("click", () => {
      this.onOpenAutofill()
    })
    document.getElementById("ho-mark-submitted")?.addEventListener("click", async () => {
      const btn = document.getElementById("ho-mark-submitted") as HTMLButtonElement | null
      if (btn) { btn.disabled = true; btn.textContent = "Saving…" }
      await this.onMarkSubmitted(this.state.jobId)
      // Notify dashboard via postMessage
      window.postMessage({
        type: "hireoven:review-submitted",
        jobId: this.state.jobId,
        queueItemId: undefined,
      }, "*")
      this.onClose()
    })
    document.getElementById("ho-review-skip")?.addEventListener("click", () => {
      this.onClose()
    })
    document.getElementById("ho-ack-sensitive")?.addEventListener("click", () => {
      this.setState({ sensitiveAcknowledged: true })
    })
  }

  updateAutofill(result: AutofillIntelligenceResult): void {
    this.setState({ autofill: result })
  }

  unmount(): void {
    clearSubmitHighlight()
    document.getElementById(OVERLAY_ID)?.remove()
  }
}
