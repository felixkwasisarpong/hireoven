/**
 * Apply Queue Panel
 *
 * Right-side drawer showing all jobs in the apply queue with per-job
 * status, controls, and safety notices.
 *
 * Safety: purely informational + navigation. Never auto-fills or submits.
 */

import type { ApplyQueueState, QueueJobEntry, QueueItemStatus } from "../types"

const PANEL_ID = "ho-apply-queue-panel"
const OVERLAY_ID = "ho-apply-queue-overlay"

const STATUS_CONFIG: Record<QueueItemStatus, { label: string; color: string; bg: string }> = {
  queued:                  { label: "Queued",          color: "#475569", bg: "#f1f5f9" },
  tailoring:               { label: "Tailoring…",      color: "#7c3aed", bg: "#faf5ff" },
  waiting_resume_approval: { label: "Approve Resume",  color: "#b45309", bg: "#fffbeb" },
  cover_letter_ready:      { label: "Cover Ready",     color: "#0369a1", bg: "#f0f9ff" },
  autofill_ready:          { label: "Ready to Fill",   color: "#166534", bg: "#f0fdf4" },
  waiting_user_review:     { label: "Review Now",      color: "#FF5C18", bg: "#fff4f0" },
  submitted_manually:      { label: "Submitted",       color: "#166534", bg: "#f0fdf4" },
  failed:                  { label: "Failed",          color: "#991b1b", bg: "#fef2f2" },
  skipped:                 { label: "Skipped",         color: "#94a3b8", bg: "#f8fafc" },
}

function esc(s: string | null | undefined): string {
  return (s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function trim(s: string | null | undefined, max = 36): string {
  const raw = (s ?? "").trim()
  return raw.length > max ? `${raw.slice(0, max - 1)}…` : raw
}

function btnStyle(bg: string, color: string, border = "none"): string {
  return [
    `background:${bg}`,
    `border:1px solid ${border}`,
    `border-radius:6px`,
    `padding:4px 10px`,
    `font-size:11px`,
    `font-weight:600`,
    `color:${color}`,
    `cursor:pointer`,
    `font-family:inherit`,
  ].join(";")
}

function buildJobRow(job: QueueJobEntry): string {
  const cfg = STATUS_CONFIG[job.status]
  const done = job.status === "submitted_manually"
  const canSkip = !["submitted_manually", "skipped"].includes(job.status)
  const canRetry = job.status === "failed" || job.status === "skipped"
  const canOpen = !done && job.applyUrl

  const warnCount = (job.warnings ?? []).filter(
    (w) => w.severity === "warning" || w.severity === "error",
  ).length
  const warnBadge = warnCount > 0
    ? `<span style="font-size:9px;font-weight:700;background:#fef3c7;color:#92400e;border-radius:999px;padding:1px 6px;margin-left:4px">${warnCount} warn</span>`
    : ""

  const matchChip = typeof job.matchScore === "number"
    ? `<span style="font-size:9px;font-weight:700;background:#fff4f0;color:#c94010;border-radius:999px;padding:1px 5px;margin-left:4px">${Math.round(job.matchScore)}%</span>`
    : ""

  const failNote = job.failReason
    ? `<div style="font-size:10px;color:#dc2626;font-weight:600;margin-top:2px">${esc(job.failReason)}</div>`
    : ""

  const actionRow = (canOpen || canSkip || canRetry) ? `
    <div style="display:flex;gap:5px;margin-top:6px;flex-wrap:wrap">
      ${canOpen ? `<button data-action="queue-open" data-qid="${esc(job.queueId)}" style="${btnStyle("#e2e8f0", "#334155", "#e2e8f0")}">Open &amp; Fill</button>` : ""}
      ${canSkip ? `<button data-action="queue-skip" data-qid="${esc(job.queueId)}" style="${btnStyle("#f8fafc", "#64748b", "#e2e8f0")}">Skip</button>` : ""}
      ${canRetry ? `<button data-action="queue-retry" data-qid="${esc(job.queueId)}" style="${btnStyle("#fff4f0", "#c94010", "#fde8d8")}">Retry</button>` : ""}
    </div>` : ""

  return `
    <div style="padding:10px 0;border-bottom:1px solid #f1f5f9">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:6px">
        <div style="min-width:0;flex:1">
          <div style="font-size:12px;font-weight:700;color:#0f172a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(trim(job.jobTitle))}</div>
          ${job.company ? `<div style="font-size:11px;color:#64748b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(trim(job.company))}</div>` : ""}
        </div>
        <div style="flex-shrink:0;display:flex;align-items:center;gap:3px">
          <span style="font-size:10px;font-weight:700;border-radius:999px;padding:2px 8px;background:${cfg.bg};color:${cfg.color};white-space:nowrap">${cfg.label}</span>
          ${matchChip}${warnBadge}
        </div>
      </div>
      ${failNote}
      ${actionRow}
    </div>`
}

function buildPanelHTML(queue: ApplyQueueState): string {
  const done = queue.jobs.filter((j) => j.status === "submitted_manually").length
  const skipped = queue.jobs.filter((j) => j.status === "skipped").length
  const pending = queue.jobs.filter(
    (j) => !["submitted_manually", "skipped", "failed"].includes(j.status),
  ).length
  const total = queue.jobs.length

  const progressPct = total === 0 ? 0 : Math.round(((done + skipped) / total) * 100)

  const jobRows = queue.jobs.length > 0
    ? queue.jobs.map(buildJobRow).join("")
    : `<div style="padding:28px 0;text-align:center;font-size:12px;color:#94a3b8">No jobs in queue.</div>`

  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;display:flex;flex-direction:column;height:100%">

      <!-- Header -->
      <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid #f1f5f9;flex-shrink:0">
        <div style="min-width:0;flex:1">
          <div style="font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#94a3b8;margin-bottom:1px">Apply Queue</div>
          <div style="font-size:14px;font-weight:700;color:#0f172a">${done}/${total} submitted · ${pending} pending</div>
        </div>
        <button data-action="queue-panel-close" style="background:none;border:none;cursor:pointer;padding:4px;color:#94a3b8;border-radius:6px;flex-shrink:0;margin-left:8px" aria-label="Close queue panel">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1 1l12 12M13 1L1 13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        </button>
      </div>

      <!-- Progress bar -->
      <div style="padding:8px 16px 0;flex-shrink:0">
        <div style="height:4px;border-radius:999px;background:#e2e8f0;overflow:hidden">
          <div style="height:100%;width:${progressPct}%;background:#FF5C18;border-radius:999px;transition:width 300ms ease"></div>
        </div>
        <div style="display:flex;justify-content:space-between;margin-top:3px;font-size:10px;font-weight:600;color:#94a3b8">
          <span>${progressPct}% complete</span>
          <span>${done} done · ${skipped} skipped</span>
        </div>
      </div>

      <!-- Controls -->
      <div style="display:flex;gap:6px;padding:10px 16px;border-bottom:1px solid #f1f5f9;flex-shrink:0">
        <button data-action="${queue.paused ? "queue-resume" : "queue-pause"}" style="flex:1;min-height:30px;${btnStyle(queue.paused ? "#f0fdf4" : "#fffbeb", queue.paused ? "#166534" : "#92400e", queue.paused ? "#bbf7d0" : "#fde68a")}">${queue.paused ? "▶ Resume" : "⏸ Pause"}</button>
        <button data-action="queue-clear" style="min-height:30px;${btnStyle("#fef2f2", "#991b1b", "#fecaca")}">Clear all</button>
      </div>

      <!-- Safety notice -->
      <div style="margin:8px 16px 0;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:8px 10px;font-size:10px;color:#64748b;line-height:1.5;flex-shrink:0">
        🚫 Scout prepares and fills fields — <strong>you submit manually</strong>. No application ever auto-submits.
      </div>

      <!-- Job list -->
      <div style="flex:1;overflow-y:auto;padding:0 16px">
        ${jobRows}
      </div>
    </div>`
}

export interface ApplyQueuePanelCallbacks {
  onSkip: (queueId: string) => void
  onRetry: (queueId: string) => void
  onOpen: (queueId: string) => void
  onPause: () => void
  onResume: () => void
  onClear: () => void
  onClose: () => void
}

export class ApplyQueuePanel {
  private readonly cbs: ApplyQueuePanelCallbacks

  constructor(callbacks: ApplyQueuePanelCallbacks) {
    this.cbs = callbacks
  }

  get isOpen(): boolean {
    return Boolean(document.getElementById(OVERLAY_ID))
  }

  mount(queue: ApplyQueueState | null): void {
    this.unmount()

    const overlay = document.createElement("div")
    overlay.id = OVERLAY_ID
    overlay.style.cssText = [
      "position:fixed",
      "top:0",
      "left:0",
      "right:0",
      "bottom:0",
      "z-index:2147483645",
      "background:rgba(15,23,42,0.18)",
      "backdrop-filter:blur(1px)",
    ].join(";")
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) this.cbs.onClose()
    })

    const panel = document.createElement("div")
    panel.id = PANEL_ID
    panel.style.cssText = [
      "position:fixed",
      "top:0",
      "right:0",
      "bottom:0",
      "width:320px",
      "max-width:100vw",
      "background:#fff",
      "box-shadow:-4px 0 32px rgba(15,23,42,0.16)",
      "z-index:2147483646",
      "display:flex",
      "flex-direction:column",
      "overflow:hidden",
      "border-left:1px solid #e2e8f0",
    ].join(";")

    panel.innerHTML = queue
      ? buildPanelHTML(queue)
      : `<div style="padding:32px 24px;text-align:center;font-family:-apple-system,sans-serif;color:#94a3b8;font-size:13px">No active queue.</div>`

    overlay.appendChild(panel)
    document.body.appendChild(overlay)
    this.bindEvents(panel)
  }

  /** Update panel contents without remounting the overlay. */
  update(queue: ApplyQueueState | null): void {
    const panel = document.getElementById(PANEL_ID)
    if (!panel) return
    panel.innerHTML = queue
      ? buildPanelHTML(queue)
      : `<div style="padding:32px 24px;text-align:center;font-family:-apple-system,sans-serif;color:#94a3b8;font-size:13px">Queue cleared.</div>`
    this.bindEvents(panel)
  }

  private bindEvents(panel: HTMLElement): void {
    panel.querySelectorAll<HTMLButtonElement>("button[data-action]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault()
        e.stopPropagation()
        const action = btn.dataset.action ?? ""
        const qid = btn.dataset.qid ?? ""
        switch (action) {
          case "queue-open":        this.cbs.onOpen(qid); break
          case "queue-skip":        this.cbs.onSkip(qid); break
          case "queue-retry":       this.cbs.onRetry(qid); break
          case "queue-pause":       this.cbs.onPause(); break
          case "queue-resume":      this.cbs.onResume(); break
          case "queue-clear":       this.cbs.onClear(); break
          case "queue-panel-close": this.cbs.onClose(); break
        }
      })
    })
  }

  unmount(): void {
    document.getElementById(OVERLAY_ID)?.remove()
  }
}
