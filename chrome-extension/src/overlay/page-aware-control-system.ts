import { sendToBackground } from "../bridge"
import { detectExtensionPageMode, detectPage } from "../detectors/ats"
import { extractJobWithMeta } from "../extractors/job"
import type {
  AutofillExecuteResult,
  AutofillPreviewResult,
  CoverLetterResult,
  DetectedField,
  ExtensionJobFingerprint,
  ExtensionPageMode,
  ExtensionResumeSummary,
  ExtractedJob,
  ListResumesResult,
  ResolveJobResult,
  SaveResult,
  ScoutOverlayResult,
  SessionResult,
  TailorApproveResult,
  TailorPreviewResult,
} from "../types"
import {
  extractSiteContext,
  sponsorshipHintFromText,
  toExtractedJob,
  type JobCardSnapshot,
  type OverlaySite,
} from "./site-adapters"
import {
  JobScreenerPanel,
  applyScreenerFilters,
  type ScreenerCardSignals,
  type ScreenerFilters,
} from "./job-screener-panel"
import { MatchDetailPanel, type MatchDetailModel } from "./match-detail-panel"

const BRAND_ICON_URL = chrome.runtime.getURL("icons/icon48.png")

interface PageAwareOptions {
  resolveAppOrigin: () => Promise<string>
}

type DrawerMode = "none" | "autofill" | "tailor" | "cover"
type BusyAction =
  | "session"
  | "save"
  | "match"
  | "autofill-load"
  | "autofill-fill"
  | "tailor-load"
  | "tailor-approve"
  | "cover-generate"
  | "cover-insert"

interface CardInsights {
  matchPercent: number | null
  sponsorshipLikely: boolean | null
  sponsorshipLabel: string | null
  missingSkills: string[]
}

interface CardMemory {
  canonicalId: string
  savedJobId: string | null
  saving: boolean
  insights: CardInsights | null
}

interface BadgeViewModel {
  matchPercent: number | null
  hasH1B: boolean
  hasEVerify: boolean
  visaCaution: boolean
  saveLabel: string
  saved: boolean
  saveDisabled: boolean
}

const ROOT_HOST_ID = "hireoven-page-aware-controls"
const LEGACY_IDS = [
  "hireoven-scout-overlay-host",
  "hireoven-scout-bar-host",
  "hireoven-scout-command-dock",
  "hireoven-focused-intelligence-layer",
  "hireoven-search-filter-layer",
  "hireoven-job-screener",
  "hireoven-match-detail",
  ROOT_HOST_ID,
] as const

const DEFAULT_SCREENER_FILTERS: ScreenerFilters = {
  enabled: false,
  h1bOnly: false,
  eVerifyOnly: false,
  hideNoSponsor: false,
  hideViewed: false,
}

const STYLE = `
  :host { all: initial; }
  *, *::before, *::after { box-sizing: border-box; }

  .root {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 14px;
    z-index: 2147483646;
    pointer-events: none;
    font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    color: #f8fafc;
  }

  .bar-wrap {
    display: flex;
    justify-content: center;
    padding: 0 12px;
  }

  .bar {
    pointer-events: auto;
    min-height: 44px;
    max-width: min(720px, calc(100vw - 24px));
    border-radius: 999px;
    border: 1px solid rgba(15, 23, 42, 0.6);
    background: #0b1220;
    box-shadow: 0 14px 36px rgba(2, 6, 23, 0.5);
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px;
    overflow-x: auto;
    scrollbar-width: none;
  }

  .bar::-webkit-scrollbar { display: none; }

  .brand {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: 999px;
    background: #FF5C18;
    flex: 0 0 auto;
    overflow: hidden;
    box-shadow: 0 0 0 2px rgba(255, 92, 24, 0.35), inset 0 0 0 1.5px rgba(255, 255, 255, 0.22);
    transition: background 200ms ease, box-shadow 200ms ease;
  }

  .brand img {
    width: 22px;
    height: 22px;
    object-fit: contain;
    display: block;
    border-radius: 4px;
  }

  /* Mode-aware brand icon tint — subtle visual cue for which action set is active */
  .bar[data-mode="application_form"] .brand {
    background: #f59e0b;
    box-shadow: 0 0 0 2px rgba(245, 158, 11, 0.35), inset 0 0 0 2px rgba(255,255,255,0.18);
  }
  .bar[data-mode="search_results"] .brand {
    background: #6366f1;
    box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.35), inset 0 0 0 2px rgba(255,255,255,0.18);
  }

  .title {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    padding: 0 6px;
    color: #f8fafc;
    font-size: 12px;
    font-weight: 700;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1 1 auto;
  }

  .title-sub {
    color: #94a3b8;
    font-weight: 500;
    font-size: 11px;
  }

  .pill {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 20px;
    border-radius: 999px;
    padding: 0 8px;
    font-size: 10px;
    font-weight: 700;
    background: rgba(148, 163, 184, 0.16);
    color: #cbd5e1;
    white-space: nowrap;
  }

  .pill.queue {
    background: rgba(255, 92, 24, 0.13);
    color: #ffb99c;
  }

  .action {
    min-height: 30px;
    border-radius: 999px;
    border: 1px solid rgba(148, 163, 184, 0.28);
    background: rgba(30, 41, 59, 0.55);
    color: #e2e8f0;
    font-size: 11px;
    font-weight: 700;
    padding: 0 11px;
    cursor: pointer;
    white-space: nowrap;
    transition: border-color 140ms ease, background 140ms ease, opacity 140ms ease;
  }

  .action:hover {
    border-color: rgba(255, 92, 24, 0.55);
    background: rgba(255, 92, 24, 0.16);
  }

  .action.primary {
    border-color: #FF5C18;
    background: #FF5C18;
    color: #ffffff;
  }

  .action.primary:hover {
    background: #ff7a40;
    border-color: #ff7a40;
  }

  .action.icon {
    width: 30px;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: #cbd5e1;
  }

  .action:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .avatar {
    width: 30px;
    height: 30px;
    border-radius: 999px;
    border: 1px solid rgba(148, 163, 184, 0.3);
    background: #0f172a;
    color: #f8fafc;
    font-size: 11px;
    font-weight: 760;
    cursor: pointer;
    overflow: hidden;
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .avatar img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .menu {
    pointer-events: auto;
    position: fixed;
    right: 14px;
    bottom: 64px;
    min-width: 220px;
    background: #0b1220;
    border: 1px solid rgba(148, 163, 184, 0.35);
    border-radius: 12px;
    box-shadow: 0 16px 32px rgba(2, 6, 23, 0.55);
    padding: 8px;
    display: none;
  }

  .menu[data-open="true"] { display: block; }

  .menu-head {
    padding: 4px 6px 8px;
    border-bottom: 1px solid rgba(148, 163, 184, 0.18);
    margin-bottom: 6px;
  }

  .menu-name { font-size: 12px; font-weight: 700; color: #f8fafc; }
  .menu-email { margin-top: 1px; font-size: 10px; color: #94a3b8; }

  .menu-btn {
    width: 100%;
    text-align: left;
    min-height: 28px;
    border-radius: 8px;
    border: 1px solid transparent;
    background: transparent;
    color: #e2e8f0;
    font-size: 11px;
    font-weight: 650;
    cursor: pointer;
    padding: 0 7px;
  }

  .menu-btn:hover {
    border-color: rgba(148, 163, 184, 0.3);
    background: rgba(30, 41, 59, 0.5);
  }

  .drawer-shell {
    pointer-events: auto;
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    width: min(380px, 92vw);
    background: #ffffff;
    color: #0f172a;
    box-shadow: -16px 0 36px rgba(2, 6, 23, 0.18);
    border-left: 1px solid #e2e8f0;
    display: flex;
    flex-direction: column;
    animation: ho-slide-right 180ms ease;
  }

  @keyframes ho-slide-right {
    from { transform: translateX(28px); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
  }

  .drawer-head {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px 16px;
    border-bottom: 1px solid #e2e8f0;
  }

  .drawer-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    border-radius: 10px;
    background: #FF5C18;
    overflow: hidden;
    flex: 0 0 auto;
    box-shadow: 0 2px 8px rgba(255,92,24,0.35);
  }

  .drawer-icon img {
    width: 20px;
    height: 20px;
    object-fit: contain;
    display: block;
  }

  .drawer-title {
    flex: 1;
    font-size: 14px;
    font-weight: 760;
    color: #0f172a;
  }

  .drawer-close {
    border: none;
    background: transparent;
    color: #64748b;
    font-size: 18px;
    cursor: pointer;
    padding: 4px 8px;
  }

  .drawer-body {
    flex: 1;
    overflow-y: auto;
    padding: 14px 16px;
  }

  .drawer-foot {
    padding: 12px 16px;
    border-top: 1px solid #e2e8f0;
    background: #f8fafc;
  }

  .section-label {
    font-size: 10px;
    font-weight: 720;
    color: #475569;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    margin-bottom: 6px;
  }

  .section-label .req {
    color: #dc2626;
    margin-left: 4px;
  }

  .picker {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    border-radius: 12px;
    border: 1px solid #e2e8f0;
    background: #fff;
    margin-bottom: 14px;
  }

  .picker-icon {
    width: 28px;
    height: 28px;
    border-radius: 999px;
    background: #fff4f0;
    color: #c94010;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    flex: 0 0 auto;
  }

  .picker-main {
    flex: 1;
    min-width: 0;
  }

  .picker-title {
    font-size: 12px;
    font-weight: 700;
    color: #0f172a;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .picker-sub {
    font-size: 11px;
    color: #64748b;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .picker-tag {
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.04em;
    color: #c94010;
    background: #ffe4d9;
    border-radius: 999px;
    padding: 2px 8px;
  }

  .toggle-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px;
    border-radius: 10px;
    border: 1px solid #e2e8f0;
    background: #fff;
    margin-bottom: 8px;
  }

  .toggle-row .label {
    font-size: 12px;
    font-weight: 650;
    color: #0f172a;
  }

  .toggle-row .label small {
    display: block;
    font-size: 10px;
    color: #64748b;
    margin-top: 2px;
    font-weight: 500;
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

  .toggle:checked {
    background: #FF5C18;
  }

  .toggle:checked::after {
    transform: translateX(14px);
  }

  .progress {
    margin: 4px 0 16px;
  }

  .progress-head {
    display: flex;
    justify-content: space-between;
    font-size: 11px;
    font-weight: 700;
    color: #0f172a;
    margin-bottom: 6px;
  }

  .progress-track {
    width: 100%;
    height: 6px;
    border-radius: 999px;
    background: #e2e8f0;
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    background: #FF5C18;
    border-radius: 999px;
  }

  .field-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 0;
    border-bottom: 1px solid #f1f5f9;
    font-size: 12px;
    color: #0f172a;
  }

  .field-row:last-child { border-bottom: none; }

  .field-row .check {
    width: 18px;
    height: 18px;
    border-radius: 999px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    flex: 0 0 auto;
  }

  .field-row .check.ready { color: #c94010; }
  .field-row .check.review { color: #b45309; }
  .field-row .check.missing { color: #94a3b8; }

  .field-row .label { flex: 1; min-width: 0; }
  .field-row .meta { font-size: 10px; color: #64748b; }

  .btn {
    min-height: 36px;
    border-radius: 999px;
    border: 1px solid #cbd5e1;
    background: #ffffff;
    color: #0f172a;
    font-size: 12px;
    font-weight: 700;
    padding: 0 14px;
    cursor: pointer;
  }

  .btn.primary {
    border-color: #FF5C18;
    background: #FF5C18;
    color: #ffffff;
    width: 100%;
    min-height: 42px;
    font-size: 13px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
  }

  .btn.primary:hover { background: #ff7a40; border-color: #ff7a40; }

  .btn.ghost {
    background: transparent;
    border-color: transparent;
    color: #c94010;
  }

  .btn:disabled { opacity: 0.5; cursor: default; }

  .muted {
    font-size: 11px;
    color: #475569;
    line-height: 1.5;
    margin-bottom: 12px;
  }

  .changes { display: grid; gap: 8px; margin: 10px 0; }

  .change {
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    background: #f8fafc;
    padding: 8px 10px;
  }

  .change-sec {
    font-size: 9px;
    font-weight: 760;
    color: #c94010;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin-bottom: 4px;
  }

  .change-text {
    font-size: 11px;
    color: #0f172a;
    line-height: 1.45;
  }

  .cover-text {
    width: 100%;
    min-height: 220px;
    border-radius: 10px;
    border: 1px solid #cbd5e1;
    background: #ffffff;
    color: #0f172a;
    padding: 10px;
    resize: vertical;
    font-size: 12px;
    line-height: 1.5;
    font-family: inherit;
  }

  .stats {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 10px;
  }

  .stat {
    font-size: 10px;
    border-radius: 999px;
    border: 1px solid #e2e8f0;
    background: #ffffff;
    color: #475569;
    padding: 2px 8px;
    font-weight: 600;
  }

  .warn {
    margin-top: 10px;
    border-radius: 10px;
    border: 1px solid #fde68a;
    background: #fffbeb;
    color: #92400e;
    font-size: 11px;
    line-height: 1.45;
    padding: 8px 10px;
  }

  .credits {
    margin-top: 8px;
    font-size: 10px;
    color: #64748b;
    text-align: center;
  }

  .resume-select {
    width: 100%;
    padding: 10px 12px;
    border-radius: 10px;
    border: 1px solid #e2e8f0;
    background: #fff;
    color: #0f172a;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%2394a3b8' d='M6 8L1 3h10z'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 12px center;
    padding-right: 32px;
    margin-bottom: 8px;
  }

  .resume-select:focus { outline: none; border-color: #FF5C18; box-shadow: 0 0 0 2px rgba(16,185,129,0.18); }

  .resume-score {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 10px;
    font-weight: 700;
    color: #c94010;
    background: #fff4f0;
    border-radius: 999px;
    padding: 1px 7px;
    margin-left: 6px;
  }

  .status {
    pointer-events: none;
    margin: 6px auto 0;
    text-align: center;
    font-size: 11px;
    color: #f1f5f9;
    text-shadow: 0 1px 1px rgba(2, 6, 23, 0.6);
    max-width: 720px;
  }

  @media (max-width: 720px) {
    .bar { border-radius: 22px; }
    .title-sub { display: none; }
    .drawer-shell { width: 100vw; }
  }
`

const BADGE_STYLE = `
  :host { all: initial; }
  *, *::before, *::after { box-sizing: border-box; }

  .root {
    pointer-events: auto;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin: 6px 0 4px;
    padding: 4px 6px 4px 4px;
    background: transparent;
    font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }

  .frog {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border-radius: 6px;
    background: #FF5C18;
    flex: 0 0 auto;
    overflow: hidden;
    box-shadow: 0 0 0 1.5px rgba(255,92,24,0.3);
  }

  .frog img {
    width: 14px;
    height: 14px;
    object-fit: contain;
    display: block;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    height: 20px;
    padding: 0 8px;
    border-radius: 6px;
    font-size: 11px;
    font-weight: 700;
    line-height: 1;
    white-space: nowrap;
    letter-spacing: 0.01em;
  }

  .chip.h1b {
    background: #fee2e2;
    color: #b91c1c;
    border: 1px solid #fecaca;
  }

  .chip.everify {
    background: #fee2e2;
    color: #b91c1c;
    border: 1px solid #fecaca;
  }

  .chip.match {
    background: #f1f5f9;
    color: #1e293b;
    border: 1px solid #e2e8f0;
  }

  .chip.match.has {
    background: #fff4f0;
    color: #c94010;
    border-color: rgba(255, 92, 24, 0.32);
  }

  .chip.note {
    background: #eff6ff;
    color: #1d4ed8;
    border: 1px solid #bfdbfe;
  }

  .save {
    height: 20px;
    border-radius: 6px;
    border: 1px solid #cbd5e1;
    background: #ffffff;
    color: #0f172a;
    font-size: 11px;
    font-weight: 700;
    padding: 0 10px;
    cursor: pointer;
    white-space: nowrap;
  }

  .save:hover { border-color: #FF5C18; color: #c94010; }

  .save.saved {
    background: #fff4f0;
    color: #c94010;
    border-color: rgba(255, 92, 24, 0.32);
  }

  .save:disabled { opacity: 0.6; cursor: default; }
`

function esc(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
}

function trimText(value: string | null | undefined, max = 120): string {
  const raw = (value ?? "").trim()
  if (!raw) return ""
  if (raw.length <= max) return raw
  return `${raw.slice(0, max - 1)}…`
}

function norm(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/\s+/g, " ").trim()
}

function initials(name: string | null | undefined, email: string | null | undefined): string {
  const base = (name ?? "").trim() || (email?.split("@")[0] ?? "")
  const tokens = base.split(/\s+/).filter(Boolean)
  if (tokens.length >= 2) return `${tokens[0][0] ?? ""}${tokens[1][0] ?? ""}`.toUpperCase()
  if (tokens.length === 1) return tokens[0]?.slice(0, 2).toUpperCase() ?? "HO"
  return "HO"
}

function canonicalIdForCard(card: JobCardSnapshot): string {
  if (card.url) {
    try {
      const parsed = new URL(card.url)
      const host = parsed.hostname.replace(/^www\./i, "").toLowerCase()
      if (host.includes("linkedin.com")) {
        const m = parsed.pathname.match(/\/jobs\/view\/(\d+)/)
        if (m?.[1]) return `linkedin:${m[1]}`
      }
      if (host.includes("glassdoor.com")) {
        const m = parsed.pathname.match(/_JK([A-Za-z0-9]+)/)
        if (m?.[1]) return `glassdoor:${m[1]}`
      }
      return `${host}${parsed.pathname}`
    } catch {
      // ignore URL parse errors
    }
  }
  return `${card.site}:${norm(card.title)}|${norm(card.company)}|${norm(card.location)}`
}

function externalJobIdFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url)
    for (const key of ["gh_jid", "jobId", "job_id", "reqId", "req_id", "opening_id", "posting_id"]) {
      const value = parsed.searchParams.get(key)
      if (value?.trim()) return value.trim()
    }
    const linkedin = parsed.pathname.match(/\/jobs\/view\/(\d+)/)
    if (linkedin?.[1]) return linkedin[1]
    const glassdoor = parsed.pathname.match(/_JK([A-Za-z0-9]+)\./)
    if (glassdoor?.[1]) return glassdoor[1]
    const icims = parsed.pathname.match(/\/job\/([^/?#]+)/i)
    if (icims?.[1]) return icims[1]
  } catch {
    // ignore malformed URLs
  }
  return null
}

function hasReachableApplySurface(): boolean {
  const formSelectors = [
    "form[action*='apply']",
    "form[id*='apply']",
    "form[class*='apply']",
    "[id*='application-form']",
    "[class*='application-form']",
  ]

  for (const selector of formSelectors) {
    if (document.querySelector(selector)) return true
  }

  const actions = Array.from(document.querySelectorAll<HTMLElement>("a,button")).slice(0, 140)
  return actions.some((node) => /apply|easy apply|start application|continue application/i.test(node.textContent ?? ""))
}

function statusOfField(field: DetectedField): "ready" | "review" | "missing" {
  if (!field.detectedValue) return "missing"
  if (field.type === "file") return "review"
  if (field.needsReview) return "review"
  if (field.confidence < 0.65) return "review"
  return "ready"
}

function safeFieldsToFill(fields: DetectedField[]): Array<{ elementRef: string; value: string }> {
  return fields
    .filter((field) => {
      if (!field.elementRef || !field.detectedValue) return false
      if (field.type === "file") return false
      if (field.needsReview) return false
      if (field.confidence < 0.65) return false
      if (field.suggestedProfileKey === "cover_letter" || field.suggestedProfileKey === "cover_letter_text") return false
      return true
    })
    .map((field) => ({ elementRef: field.elementRef, value: field.detectedValue }))
}

function memoryHasMatch(memory: CardMemory | undefined): boolean {
  return memory?.insights != null && memory.insights.matchPercent != null
}

function badgeSignals(memory: CardMemory, card: JobCardSnapshot): { hasH1B: boolean; hasEVerify: boolean; visaCaution: boolean } {
  const text = `${card.title ?? ""} ${card.description ?? ""} ${memory.insights?.sponsorshipLabel ?? ""}`.toLowerCase()
  const memSignal = memory.insights?.sponsorshipLikely
  const hint = sponsorshipHintFromText(card)
  const sponsorshipPositive = memSignal === true || hint === true || /\b(?:h-?1b|opt|cpt|sponsor(?:ship)?)\b/.test(text)
  const sponsorshipNegative = memSignal === false || hint === false || /(?:no|not)\s+(?:visa|sponsorship)|without\s+sponsorship/.test(text)
  const hasEVerify = /\be[-\s]?verify\b/.test(text)
  return {
    hasH1B: sponsorshipPositive,
    hasEVerify,
    visaCaution: sponsorshipNegative && !sponsorshipPositive,
  }
}

class MiniJobBadge {
  private readonly host: HTMLElement
  private readonly shadow: ShadowRoot
  private readonly root: HTMLElement

  private onSave: (() => void) | null = null

  constructor(private cardHost: HTMLElement) {
    this.host = document.createElement("div")
    this.host.className = "ho-mini-job-badge"
    this.host.style.cssText = "display:block;width:100%;all:initial;"

    this.shadow = this.host.attachShadow({ mode: "closed" })
    const style = document.createElement("style")
    style.textContent = BADGE_STYLE
    this.shadow.appendChild(style)

    this.root = document.createElement("div")
    this.root.className = "root"
    this.shadow.appendChild(this.root)

    this.ensureAttached()
  }

  private ensureAttached(): void {
    if (!this.host.isConnected || this.host.parentElement !== this.cardHost) {
      this.cardHost.appendChild(this.host)
    }
  }

  private renderHtml(model: BadgeViewModel): string {
    const matchClass = model.matchPercent != null ? "chip match has" : "chip match"
    const matchLabel = model.matchPercent != null ? `${Math.round(model.matchPercent)}%` : "Match"
    return `
      <span class="frog" title="Hireoven"><img src="${BRAND_ICON_URL}" alt="Hireoven" /></span>
      ${model.hasH1B ? `<span class="chip h1b">H1B</span>` : ""}
      ${model.hasEVerify ? `<span class="chip everify">E-Verify</span>` : ""}
      ${model.visaCaution ? `<span class="chip note">No sponsor</span>` : ""}
      <span class="${matchClass}">${matchLabel}</span>
      <button type="button" class="save${model.saved ? " saved" : ""}" data-role="save" ${model.saveDisabled ? "disabled" : ""}>${esc(model.saveLabel)}</button>
    `
  }

  update(cardHost: HTMLElement, model: BadgeViewModel, onSave: () => void): void {
    this.cardHost = cardHost
    this.onSave = onSave
    this.ensureAttached()

    this.root.innerHTML = this.renderHtml(model)

    const saveButton = this.root.querySelector<HTMLButtonElement>("[data-role='save']")
    saveButton?.addEventListener("click", (event) => {
      event.preventDefault()
      event.stopPropagation()
      this.onSave?.()
    })
    saveButton?.addEventListener("mousedown", (event) => {
      event.preventDefault()
      event.stopPropagation()
    })
  }

  destroy(): void {
    this.host.remove()
  }
}

export class PageAwareControlSystem {
  private readonly options: PageAwareOptions

  private host: HTMLElement | null = null
  private shadow: ShadowRoot | null = null
  private root: HTMLElement | null = null

  private appOrigin = "http://localhost:3000"
  private authenticated = false
  private user: SessionResult["user"] = null

  private mode: ExtensionPageMode = "unknown"
  private hasReachableForm = false

  private drawer: DrawerMode = "none"
  private profileOpen = false
  private statusLine = ""

  private activeCardKey: string | null = null
  private activeJob: ExtractedJob | null = null

  private resultCardKeys: string[] = []
  private readonly cardsByKey = new Map<string, JobCardSnapshot>()
  private readonly canonicalByKey = new Map<string, string>()
  private readonly memoryByCanonical = new Map<string, CardMemory>()
  private readonly badgeByKey = new Map<string, MiniJobBadge>()
  private readonly viewedCanonical = new Set<string>()

  private screenerPanel: JobScreenerPanel | null = null
  private screenerFilters: ScreenerFilters = { ...DEFAULT_SCREENER_FILTERS }
  private matchPanel: MatchDetailPanel | null = null
  private readonly autoMatchTriggered = new Set<string>()
  private autoMatchTimer: number | null = null

  private resumeList: ExtensionResumeSummary[] = []
  private resumeListLoading = false
  private selectedResumeId: string | null = null

  private autofillPreview: AutofillPreviewResult | null = null
  private autofillFilledCount: number | null = null
  private autofillUseTailored = true
  private autofillUseCover = true
  private tailorPreview: TailorPreviewResult | null = null
  private coverLetterText = ""
  private coverLetterFieldRef: string | null = null
  private approvedTailoredVersion: string | null = null
  private currentTailorResumeId: string | null = null

  private readonly busy = new Set<BusyAction>()

  private observer: MutationObserver | null = null
  private scanTimer: number | null = null
  private urlTimer: number | null = null
  private lastUrl = window.location.href

  constructor(options: PageAwareOptions) {
    this.options = options
  }

  async mount(): Promise<void> {
    this.cleanupLegacyHosts()
    this.createSurface()

    this.appOrigin = await this.options.resolveAppOrigin()
    await this.refreshSession()
    this.scanNow()

    this.bindObservers()
  }

  destroy(): void {
    if (this.scanTimer) window.clearTimeout(this.scanTimer)
    if (this.urlTimer) window.clearInterval(this.urlTimer)
    if (this.autoMatchTimer) window.clearTimeout(this.autoMatchTimer)

    this.observer?.disconnect()
    this.observer = null

    for (const badge of this.badgeByKey.values()) badge.destroy()
    this.badgeByKey.clear()

    this.screenerPanel?.destroy()
    this.screenerPanel = null
    this.matchPanel?.destroy()
    this.matchPanel = null

    this.host?.remove()
    this.host = null
    this.shadow = null
    this.root = null
  }

  private cleanupLegacyHosts(): void {
    for (const id of LEGACY_IDS) {
      document.querySelectorAll(`#${id}`).forEach((node) => node.remove())
    }
  }

  private createSurface(): void {
    const mountPoint = document.body ?? document.documentElement

    this.host = document.createElement("div")
    this.host.id = ROOT_HOST_ID
    mountPoint.appendChild(this.host)

    this.shadow = this.host.attachShadow({ mode: "closed" })
    const style = document.createElement("style")
    style.textContent = STYLE
    this.shadow.appendChild(style)

    this.root = document.createElement("div")
    this.root.className = "root"
    this.shadow.appendChild(this.root)
  }

  private bindObservers(): void {
    this.observer = new MutationObserver(() => this.scheduleScan(130))
    if (document.body) {
      this.observer.observe(document.body, { childList: true, subtree: true })
    }

    this.urlTimer = window.setInterval(() => {
      const next = window.location.href
      if (next === this.lastUrl) return
      this.lastUrl = next
      this.drawer = "none"
      this.profileOpen = false
      this.autofillPreview = null
      this.autofillFilledCount = null
      this.tailorPreview = null
      this.coverLetterText = ""
      this.coverLetterFieldRef = null
      this.scheduleScan(20)
    }, 360)
  }

  private scheduleScan(delayMs: number): void {
    if (this.scanTimer) window.clearTimeout(this.scanTimer)
    this.scanTimer = window.setTimeout(() => {
      this.scanTimer = null
      this.scanNow()
    }, delayMs)
  }

  private ensureMemory(canonicalId: string): CardMemory {
    const existing = this.memoryByCanonical.get(canonicalId)
    if (existing) return existing

    const created: CardMemory = {
      canonicalId,
      savedJobId: null,
      saving: false,
      insights: null,
    }
    this.memoryByCanonical.set(canonicalId, created)
    return created
  }

  private scanNow(): void {
    const page = detectPage()
    const modeDetected = detectExtensionPageMode()
    const siteContext = extractSiteContext()

    const cards = siteContext.cards.filter((card) => card.host.isConnected)
    const resultCards = cards.filter((card) => card.role === "result")
    const detailCard = cards.find((card) => card.role === "detail") ?? null

    this.cardsByKey.clear()
    this.canonicalByKey.clear()

    for (const card of cards) {
      this.cardsByKey.set(card.key, card)
      const canonicalId = canonicalIdForCard(card)
      this.canonicalByKey.set(card.key, canonicalId)
      this.ensureMemory(canonicalId)
    }

    this.hasReachableForm = page.pageType === "application_form" || hasReachableApplySurface()

    if (page.pageType === "application_form") {
      this.mode = "application_form"
    } else if (detailCard || modeDetected === "job_detail") {
      this.mode = "job_detail"
    } else if (siteContext.isSearchPage || resultCards.length > 1 || modeDetected === "search_results") {
      this.mode = "search_results"
    } else {
      this.mode = modeDetected
    }

    this.activeCardKey = detailCard?.key ?? resultCards[0]?.key ?? null

    if (detailCard) {
      this.activeJob = toExtractedJob(detailCard)
    } else if (this.mode === "job_detail" || this.mode === "application_form") {
      this.activeJob = extractJobWithMeta(page.ats).job
    } else {
      this.activeJob = null
    }

    this.resultCardKeys = resultCards.map((c) => c.key)

    const showResultBadges = resultCards.length > 0 && (siteContext.isSearchPage || this.mode === "search_results")
    this.syncBadges(showResultBadges ? resultCards : [])
    this.syncScreenerPanel(showResultBadges ? resultCards : [], siteContext.site)
    this.syncMatchPanel(detailCard, siteContext.site)

    if (this.activeCardKey && !this.cardsByKey.has(this.activeCardKey)) {
      this.activeCardKey = null
    }

    this.render()
  }

  private cardScreenerSignals(card: JobCardSnapshot): ScreenerCardSignals {
    const canonicalId = this.canonicalByKey.get(card.key) ?? canonicalIdForCard(card)
    const memory = this.ensureMemory(canonicalId)
    const signals = badgeSignals(memory, card)
    return {
      hasH1B: signals.hasH1B,
      hasEVerify: signals.hasEVerify,
      hasNoSponsor: signals.visaCaution,
      viewed: this.viewedCanonical.has(canonicalId),
    }
  }

  private syncScreenerPanel(resultCards: JobCardSnapshot[], site: OverlaySite): void {
    const supported = site === "linkedin" || site === "glassdoor" || site === "indeed"
    if (!supported || resultCards.length === 0) {
      this.screenerPanel?.destroy()
      this.screenerPanel = null
      for (const card of this.cardsByKey.values()) card.host.style.removeProperty("display")
      return
    }

    if (!this.screenerPanel) {
      this.screenerPanel = new JobScreenerPanel({
        site,
        initial: this.screenerFilters,
        onChange: (filters) => {
          this.screenerFilters = filters
          this.applyScreener()
        },
      })
    }

    const mounted = this.screenerPanel.ensureMounted()
    if (!mounted) return

    this.applyScreener()
  }

  private applyScreener(): void {
    const cards = Array.from(this.cardsByKey.values()).filter((card) => card.role === "result")
    const cardsWithSignals = cards.map((card) => ({ card, signals: this.cardScreenerSignals(card) }))
    applyScreenerFilters(this.screenerFilters, cardsWithSignals)
  }

  private syncMatchPanel(detailCard: JobCardSnapshot | null, site: OverlaySite): void {
    const supported = site === "linkedin" || site === "glassdoor" || site === "indeed"
    if (!supported || !detailCard || this.mode !== "job_detail") {
      this.matchPanel?.destroy()
      this.matchPanel = null
      return
    }

    if (!this.matchPanel) {
      this.matchPanel = new MatchDetailPanel(site, {
        onMatch: () => void this.matchActive(),
        onTailor: () => void this.openTailorDrawer(),
        onCover: () => void this.openCoverDrawer(),
        onAutofill: () => void this.openAutofillDrawer(),
        onOpenInHireoven: () => this.openHireovenJob(),
      })
    }

    const mounted = this.matchPanel.ensureMounted()
    if (!mounted) return

    const canonicalId = canonicalIdForCard(detailCard)
    this.viewedCanonical.add(canonicalId)
    const memory = this.ensureMemory(canonicalId)

    const model: MatchDetailModel = {
      matchPercent: memory.insights?.matchPercent ?? null,
      missingSkills: memory.insights?.missingSkills ?? [],
      sponsorshipLabel:
        memory.insights?.sponsorshipLabel ??
        (memory.insights?.sponsorshipLikely === true
          ? "Visa likely"
          : memory.insights?.sponsorshipLikely === false
            ? "Visa caution"
            : null),
      loading: this.isBusy("match"),
      hasReachableForm: this.hasReachableForm,
    }

    this.matchPanel.update(model)
    this.maybeAutoMatch(canonicalId)
  }

  private queuePosition(): { position: number; total: number; nextKey: string | null } | null {
    const keys = this.resultCardKeys
    if (keys.length === 0) return null
    const activeKey = this.activeCardKey
    if (!activeKey) {
      const activeCanon = this.activeCanonicalId()
      if (!activeCanon) return null
      const matchedKey = keys.find((k) => this.canonicalByKey.get(k) === activeCanon)
      if (!matchedKey) return null
      const idx = keys.indexOf(matchedKey)
      return { position: idx + 1, total: keys.length, nextKey: keys[idx + 1] ?? null }
    }
    const idx = keys.indexOf(activeKey)
    if (idx < 0) return null
    return { position: idx + 1, total: keys.length, nextKey: keys[idx + 1] ?? null }
  }

  private gotoNextInQueue(): void {
    const queue = this.queuePosition()
    if (!queue || !queue.nextKey) {
      this.setStatus("End of result list.")
      return
    }
    const card = this.cardsByKey.get(queue.nextKey)
    if (!card) return
    const link =
      card.host.querySelector<HTMLAnchorElement>(
        "a.job-card-container__link, a.base-card__full-link, a[href*='/jobs/view/'], a[data-test='job-title'], a[href*='job-listing'], h2.jobTitle a, a[href*='viewjob']",
      ) ?? card.host.querySelector<HTMLElement>("a, button")
    if (link instanceof HTMLAnchorElement) {
      link.click()
    } else if (link) {
      link.click()
    }
  }

  private renderResumePicker(): string {
    const label = `<div class="section-label">Target Resume <span style="color:#64748b">(Optional)</span></div>`

    if (this.resumeListLoading) {
      return `${label}<div class="muted" style="font-size:11px;padding:4px 0">Loading your resumes…</div>`
    }

    if (this.resumeList.length === 0) {
      return `${label}<div class="muted" style="font-size:11px;padding:4px 0">No resumes found. Upload one in Hireoven first.</div>`
    }

    const selectedId = this.selectedResumeId ?? this.resumeList[0]?.id ?? ""
    const selectedResume = this.resumeList.find((r) => r.id === selectedId)

    const options = this.resumeList
      .map((r) => {
        const label = r.isPrimary ? `${r.name} (Primary)` : r.name
        const score = r.score != null ? ` — ${Math.round(r.score)}%` : ""
        return `<option value="${esc(r.id)}" ${r.id === selectedId ? "selected" : ""}>${esc(label)}${esc(score)}</option>`
      })
      .join("")

    const scoreChip = selectedResume?.score != null
      ? `<span class="resume-score">ATS ${Math.round(selectedResume.score)}%</span>`
      : ""

    const tailoredNote = this.approvedTailoredVersion
      ? `<label class="toggle-row" style="margin-top:6px">
           <span class="label">Use tailored version<small>${esc(this.approvedTailoredVersion)} — already applied</small></span>
           <input type="checkbox" class="toggle" data-action="toggle-tailored" ${this.autofillUseTailored ? "checked" : ""}/>
         </label>`
      : ""

    return `
      ${label}
      <div style="position:relative">
        <select class="resume-select" data-action="select-resume" aria-label="Select resume">
          ${options}
        </select>
      </div>
      ${scoreChip}
      ${tailoredNote}
    `
  }

  private effectiveResumeId(): string | undefined {
    return this.currentTailorResumeId ?? this.selectedResumeId ?? undefined
  }

  private async ensureResumeList(): Promise<void> {
    if (this.resumeList.length > 0 || this.resumeListLoading) return
    this.resumeListLoading = true
    this.render()
    try {
      const raw = await sendToBackground({ type: "LIST_RESUMES" })
      const result = raw as ListResumesResult
      if (result.type === "LIST_RESUMES_RESULT") {
        this.resumeList = result.resumes
        if (!this.selectedResumeId) {
          const primary = result.resumes.find((r) => r.isPrimary)
          this.selectedResumeId = primary?.id ?? result.resumes[0]?.id ?? null
        }
      }
    } catch {
      // leave empty — handled gracefully in UI
    } finally {
      this.resumeListLoading = false
      this.render()
    }
  }

  private maybeAutoMatch(canonicalId: string): void {
    if (!this.authenticated) return
    if (memoryHasMatch(this.memoryByCanonical.get(canonicalId))) return
    if (this.autoMatchTriggered.has(canonicalId)) return
    if (this.isBusy("match") || this.isBusy("save")) return

    this.autoMatchTriggered.add(canonicalId)
    if (this.autoMatchTimer) window.clearTimeout(this.autoMatchTimer)
    this.autoMatchTimer = window.setTimeout(() => {
      this.autoMatchTimer = null
      void this.matchActive()
    }, 800)
  }

  private syncBadges(resultCards: JobCardSnapshot[]): void {
    const seen = new Set<string>()

    for (const card of resultCards) {
      seen.add(card.key)

      const canonicalId = this.canonicalByKey.get(card.key)
      if (!canonicalId) continue

      const memory = this.ensureMemory(canonicalId)
      const signals = badgeSignals(memory, card)
      const matchPercent = memory.insights?.matchPercent ?? null

      const badgeModel: BadgeViewModel = {
        matchPercent,
        hasH1B: signals.hasH1B,
        hasEVerify: signals.hasEVerify,
        visaCaution: signals.visaCaution,
        saveLabel: memory.saving ? "Saving" : memory.savedJobId ? "Saved" : "Save",
        saved: Boolean(memory.savedJobId),
        saveDisabled: memory.saving || Boolean(memory.savedJobId),
      }

      let badge = this.badgeByKey.get(card.key)
      if (!badge) {
        badge = new MiniJobBadge(card.host)
        this.badgeByKey.set(card.key, badge)
      }

      badge.update(card.host, badgeModel, () => {
        void this.saveFromBadge(card.key)
      })
    }

    for (const [key, badge] of this.badgeByKey) {
      if (seen.has(key)) continue
      badge.destroy()
      this.badgeByKey.delete(key)
    }
  }

  private async refreshSession(): Promise<void> {
    this.busy.add("session")
    try {
      const raw = await sendToBackground({ type: "GET_SESSION" })
      const session = raw as SessionResult
      this.authenticated = Boolean(session.authenticated)
      this.user = session.user ?? null
    } catch {
      this.authenticated = false
      this.user = null
    } finally {
      this.busy.delete("session")
    }
  }

  private setStatus(line: string): void {
    this.statusLine = trimText(line, 200)
    this.render()
  }

  private barTitleHtml(): string {
    if (this.mode === "application_form") {
      if (this.autofillFilledCount != null && this.autofillPreview) {
        const total = this.autofillPreview.totalFields || this.autofillFilledCount
        const pct = total === 0 ? 100 : Math.round((this.autofillFilledCount / total) * 100)
        return `Autofill Results <span class="pill queue">${pct}%</span><span class="title-sub">${this.autofillFilledCount}/${total} filled</span>`
      }
      return `Autofill this Application<span class="title-sub">Click Autofill to begin</span>`
    }
    if (this.mode === "job_detail") {
      const job = this.activeJob
      const title = trimText(job?.title ?? "Job detail", 48)
      const company = trimText(job?.company ?? "", 28)
      const queue = this.queuePosition()
      const queuePill = queue ? `<span class="pill queue">${queue.position}/${queue.total}</span>` : ""
      return `${esc(title)}${queuePill}${company ? `<span class="title-sub">${esc(company)}</span>` : ""}`
    }
    if (this.mode === "search_results") {
      const count = this.cardsByKey.size
      return `Job search<span class="title-sub">${count} ${count === 1 ? "match" : "matches"} on page</span>`
    }
    return `Hireoven<span class="title-sub">Browse jobs to begin</span>`
  }

  private resolveAvatarUrl(raw: string | null | undefined): string | null {
    if (!raw?.trim()) return null
    const value = raw.trim()
    if (/^https?:\/\//i.test(value)) return value
    if (value.startsWith("/")) return `${this.appOrigin}${value}`
    return `${this.appOrigin}/${value}`
  }

  private isBusy(action: BusyAction): boolean {
    return this.busy.has(action)
  }

  private async runBusy<T>(action: BusyAction, task: () => Promise<T>): Promise<T> {
    this.busy.add(action)
    this.render()
    try {
      return await task()
    } finally {
      this.busy.delete(action)
      this.render()
    }
  }

  private activeCard(): JobCardSnapshot | null {
    if (!this.activeCardKey) return null
    return this.cardsByKey.get(this.activeCardKey) ?? null
  }

  private activeCanonicalId(): string | null {
    const active = this.activeCard()
    if (active) return canonicalIdForCard(active)

    const job = this.activeJob
    if (!job) return null
    const fallback = `${job.ats}:${norm(job.title)}|${norm(job.company)}|${norm(job.location)}|${norm(job.url)}`
    return fallback || null
  }

  private activeFingerprint(job: ExtractedJob): ExtensionJobFingerprint {
    const sourceUrl = window.location.href
    const applyUrl = job.url || sourceUrl
    return {
      sourceUrl,
      applyUrl,
      atsProvider: job.ats,
      externalJobId: externalJobIdFromUrl(applyUrl) ?? externalJobIdFromUrl(sourceUrl),
      title: job.title,
      company: job.company,
    }
  }

  private activeJobPayload(job: ExtractedJob): ExtractedJob {
    const sourceUrl = window.location.href
    const applyUrl = job.url || sourceUrl
    const externalJobId = externalJobIdFromUrl(applyUrl) ?? externalJobIdFromUrl(sourceUrl)
    return {
      ...job,
      sourceUrl,
      applyUrl,
      externalJobId,
      url: applyUrl,
    }
  }

  private async resolveOrSaveJob(canonicalId: string, job: ExtractedJob): Promise<string | null> {
    const memory = this.ensureMemory(canonicalId)
    if (memory.savedJobId) return memory.savedJobId
    if (memory.saving) return null

    memory.saving = true
    this.render()
    this.scanNow()

    try {
      const fingerprint = this.activeFingerprint(job)

      try {
        const resolveRaw = await sendToBackground({ type: "RESOLVE_JOB", fingerprint })
        const resolved = resolveRaw as ResolveJobResult
        if (resolved.exists && resolved.jobId) {
          memory.savedJobId = resolved.jobId
          return resolved.jobId
        }
      } catch {
        // continue to save path
      }

      const saveRaw = await sendToBackground({ type: "SAVE_JOB", job: this.activeJobPayload(job) })
      const saved = saveRaw as SaveResult
      if (saved.saved && saved.jobId) {
        memory.savedJobId = saved.jobId
        return saved.jobId
      }
      return null
    } finally {
      memory.saving = false
      this.scanNow()
      this.render()
    }
  }

  private async ensureActiveJobId(): Promise<string | null> {
    const canonicalId = this.activeCanonicalId()
    const job = this.activeJob
    if (!canonicalId || !job) return null
    return this.resolveOrSaveJob(canonicalId, job)
  }

  private async saveFromBadge(key: string): Promise<void> {
    if (!this.authenticated) {
      this.openPath("/login")
      return
    }

    const card = this.cardsByKey.get(key)
    if (!card) return

    const canonicalId = this.canonicalByKey.get(key)
    if (!canonicalId) return

    const jobId = await this.resolveOrSaveJob(canonicalId, toExtractedJob(card))
    if (jobId) {
      this.setStatus("Saved to Hireoven.")
      return
    }

    this.setStatus("Could not save this job yet.")
  }

  private async saveActive(): Promise<void> {
    if (!this.authenticated) {
      this.openPath("/login")
      return
    }

    await this.runBusy("save", async () => {
      const jobId = await this.ensureActiveJobId()
      if (jobId) {
        this.setStatus("Saved to Hireoven.")
        return
      }

      this.setStatus("Could not save this job yet.")
    })
  }

  private async matchActive(): Promise<void> {
    if (!this.authenticated) {
      this.openPath("/login")
      return
    }

    const job = this.activeJob
    const canonicalId = this.activeCanonicalId()
    if (!job || !canonicalId) {
      this.setStatus("No job context found on this page.")
      return
    }

    const jobId = await this.ensureActiveJobId()
    if (!jobId) {
      this.setStatus("Save this job first to run match.")
      return
    }

    await this.runBusy("match", async () => {
      try {
        const raw = await sendToBackground({ type: "GET_SCOUT_OVERLAY", jobId })
        const result = raw as ScoutOverlayResult

        if (result.type === "SCOUT_OVERLAY_RESULT" && result.ok) {
          const memory = this.ensureMemory(canonicalId)
          memory.insights = {
            matchPercent: result.matchPercent,
            sponsorshipLikely: result.sponsorshipLikely,
            sponsorshipLabel: result.sponsorshipLabel,
            missingSkills: result.missingSkills ?? [],
          }
          this.scanNow()

          const pct = result.matchPercent == null ? "--" : `${Math.round(result.matchPercent)}%`
          const visa =
            result.sponsorshipLabel ??
            (result.sponsorshipLikely === true
              ? "Visa likely"
              : result.sponsorshipLikely === false
              ? "Visa caution"
              : "No visa signal")
          this.setStatus(`Match ${pct} · ${visa}`)
          return
        }

        this.setStatus("Match is not ready yet.")
      } catch {
        this.setStatus("Could not run match right now.")
      }
    })
  }

  private async openAutofillDrawer(): Promise<void> {
    if (!this.authenticated) {
      this.openPath("/login")
      return
    }

    this.drawer = "autofill"
    this.profileOpen = false
    this.autofillFilledCount = null
    this.render()

    void this.ensureResumeList()

    await this.runBusy("autofill-load", async () => {
      try {
        const raw = await sendToBackground({ type: "GET_AUTOFILL_PREVIEW" })
        this.autofillPreview = raw as AutofillPreviewResult
        const coverField = this.autofillPreview.fields.find((field) => field.suggestedProfileKey === "cover_letter_text")
        this.coverLetterFieldRef = coverField?.elementRef ?? null
        this.setStatus("Autofill preview loaded. Review before submitting.")
      } catch {
        this.autofillPreview = {
          type: "AUTOFILL_PREVIEW_RESULT",
          formFound: false,
          ats: "generic",
          totalFields: 0,
          matchedFields: 0,
          reviewFields: 0,
          fields: [],
          profileMissing: false,
        }
        this.setStatus("Could not load autofill preview.")
      }
    })
  }

  private async fillSafeFields(): Promise<void> {
    const preview = this.autofillPreview
    if (!preview) return

    const safe = safeFieldsToFill(preview.fields)
    if (safe.length === 0 && !this.autofillUseCover) {
      this.setStatus("No safe high-confidence fields to fill.")
      return
    }

    await this.runBusy("autofill-fill", async () => {
      try {
        let filledCount = 0
        if (safe.length > 0) {
          const raw = await sendToBackground({ type: "EXECUTE_AUTOFILL", fields: safe })
          const result = raw as AutofillExecuteResult
          filledCount = result.filledCount
        }

        if (this.autofillUseCover && this.coverLetterText.trim() && this.coverLetterFieldRef) {
          try {
            await sendToBackground({
              type: "FILL_COVER_LETTER",
              elementRef: this.coverLetterFieldRef,
              text: this.coverLetterText,
            })
            filledCount += 1
          } catch {
            // continue; user can retry from cover drawer
          }
        }

        this.autofillFilledCount = filledCount
        this.setStatus(`${filledCount} field${filledCount === 1 ? "" : "s"} filled. Review before submit.`)
      } catch {
        this.setStatus("Autofill failed. Please retry.")
      }
    })
  }

  private async openTailorDrawer(): Promise<void> {
    if (!this.authenticated) {
      this.openPath("/login")
      return
    }

    const jobId = await this.ensureActiveJobId()
    if (!jobId) {
      this.setStatus("Save this job first to tailor your resume.")
      return
    }

    this.drawer = "tailor"
    this.profileOpen = false
    this.render()

    await this.runBusy("tailor-load", async () => {
      try {
        const raw = await sendToBackground({
          type: "GET_TAILOR_PREVIEW",
          jobId,
          resumeId: this.effectiveResumeId(),
          ats: this.activeJob?.ats,
        })
        this.tailorPreview = raw as TailorPreviewResult
        this.currentTailorResumeId = this.tailorPreview.resumeId ?? this.currentTailorResumeId
        this.setStatus("Tailor preview loaded.")
      } catch {
        this.tailorPreview = {
          type: "TAILOR_PREVIEW_RESULT",
          status: "missing_job_context",
          summary: "Could not load tailor preview.",
          atsTip: null,
          atsName: null,
          resumeId: null,
          resumeName: null,
          jobTitle: null,
          company: null,
          matchScore: null,
          changesPreview: [],
        }
        this.setStatus("Could not load tailor preview.")
      }
    })
  }

  private async approveTailoredResume(): Promise<void> {
    const jobId = await this.ensureActiveJobId()
    if (!jobId) {
      this.setStatus("Save this job first to apply tailoring.")
      return
    }

    await this.runBusy("tailor-approve", async () => {
      try {
        const raw = await sendToBackground({
          type: "APPROVE_TAILORED_RESUME",
          jobId,
          resumeId: this.effectiveResumeId(),
          ats: this.activeJob?.ats,
        })
        const result = raw as TailorApproveResult
        if (result.success) {
          this.approvedTailoredVersion = result.versionName ?? "Tailored version ready"
          this.currentTailorResumeId = result.resumeId ?? this.currentTailorResumeId
          this.setStatus("Tailored version approved. Original resume was not modified.")
          return
        }
        this.setStatus(result.error ?? "Could not approve tailored version.")
      } catch {
        this.setStatus("Could not approve tailored version.")
      }
    })
  }

  private async openCoverDrawer(): Promise<void> {
    if (!this.authenticated) {
      this.openPath("/login")
      return
    }

    this.drawer = "cover"
    this.profileOpen = false
    this.render()

    const jobId = await this.ensureActiveJobId()
    if (!jobId) {
      this.setStatus("Save this job first to generate a cover letter.")
      return
    }

    await this.generateCoverLetter(jobId)
  }

  private async generateCoverLetter(jobId: string): Promise<void> {
    await this.runBusy("cover-generate", async () => {
      try {
        const raw = await sendToBackground({
          type: "GENERATE_COVER_LETTER",
          jobId,
          resumeId: this.effectiveResumeId(),
          ats: this.activeJob?.ats,
        })
        const result = raw as CoverLetterResult
        if (result.success && result.coverLetter) {
          this.coverLetterText = result.coverLetter
          this.setStatus("Cover letter generated. Review before inserting.")
          return
        }
        this.coverLetterText = result.error ?? "Could not generate cover letter."
        this.setStatus("Could not generate cover letter.")
      } catch {
        this.coverLetterText = "Could not generate cover letter."
        this.setStatus("Could not generate cover letter.")
      }
    })
  }

  private async insertCoverLetter(): Promise<void> {
    if (!this.coverLetterText.trim()) return

    if (!this.coverLetterFieldRef) {
      const field = this.autofillPreview?.fields.find((item) => item.suggestedProfileKey === "cover_letter_text")
      this.coverLetterFieldRef = field?.elementRef ?? null
    }

    if (!this.coverLetterFieldRef) {
      this.setStatus("No cover-letter text field detected.")
      return
    }

    await this.runBusy("cover-insert", async () => {
      try {
        await sendToBackground({
          type: "FILL_COVER_LETTER",
          elementRef: this.coverLetterFieldRef!,
          text: this.coverLetterText,
        })
        this.setStatus("Cover letter inserted. Review before submit.")
      } catch {
        this.setStatus("Could not insert cover letter.")
      }
    })
  }

  /**
   * Execute a Scout command by name — used when the background relays
   * commands from the Scout dashboard (OPEN_AUTOFILL, START_TAILOR, etc.).
   * Maps command names to the existing onAction action strings.
   */
  public executeAction(command: string): void {
    const commandMap: Record<string, string> = {
      OPEN_AUTOFILL: "autofill",
      START_TAILOR:  "tailor",
      START_COMPARE: "open-dashboard",
      START_WORKFLOW: "open-dashboard",
    }
    const action = commandMap[command] ?? command.toLowerCase().replace(/_/g, "-")
    void this.onAction(action)
  }

  private openPath(path: string): void {
    window.open(`${this.appOrigin}${path}`, "_blank", "noopener")
  }

  private openHireovenJob(): void {
    const canonicalId = this.activeCanonicalId()
    if (!canonicalId) {
      this.openPath("/dashboard")
      return
    }
    const memory = this.ensureMemory(canonicalId)
    if (!memory.savedJobId) {
      this.openPath("/dashboard")
      return
    }
    this.openPath(`/dashboard/jobs/${encodeURIComponent(memory.savedJobId)}`)
  }

  private async onAction(action: string): Promise<void> {
    switch (action) {
      case "save":
        await this.saveActive()
        return

      case "match":
        await this.matchActive()
        return

      case "autofill":
      case "review-fields":
        await this.openAutofillDrawer()
        return

      case "tailor":
        await this.openTailorDrawer()
        return

      case "cover":
        await this.openCoverDrawer()
        return

      case "fill-safe":
        await this.fillSafeFields()
        return

      case "reload-autofill":
        await this.openAutofillDrawer()
        return

      case "approve-tailor":
        await this.approveTailoredResume()
        return

      case "open-tailor-editor": {
        const jobId = await this.ensureActiveJobId()
        if (jobId) this.openPath(`/dashboard/resume/studio?mode=tailor&jobId=${encodeURIComponent(jobId)}`)
        return
      }

      case "generate-cover": {
        const jobId = await this.ensureActiveJobId()
        if (jobId) await this.generateCoverLetter(jobId)
        return
      }

      case "copy-cover":
        if (this.coverLetterText.trim()) {
          try {
            await navigator.clipboard.writeText(this.coverLetterText)
            this.setStatus("Cover letter copied.")
          } catch {
            this.setStatus("Clipboard copy failed.")
          }
        }
        return

      case "insert-cover":
        await this.insertCoverLetter()
        return

      case "close-drawer":
        this.drawer = "none"
        this.render()
        return

      case "select-resume":
        // handled via change event on the <select> — no-op here
        return

      case "toggle-tailored":
        this.autofillUseTailored = !this.autofillUseTailored
        this.render()
        return

      case "toggle-cover":
        this.autofillUseCover = !this.autofillUseCover
        this.render()
        return

      case "profile-toggle":
        this.profileOpen = !this.profileOpen
        this.render()
        return

      case "queue-next":
        this.gotoNextInQueue()
        return

      case "toggle-h1b-filter": {
        const next = !this.screenerFilters.h1bOnly
        this.screenerFilters = {
          ...this.screenerFilters,
          h1bOnly: next,
          // Keep enabled true as long as at least one filter is on
          enabled: next || this.screenerFilters.eVerifyOnly || this.screenerFilters.hideNoSponsor || this.screenerFilters.hideViewed,
        }
        this.applyScreener()
        this.render()
        return
      }

      case "open-dashboard":
      case "menu-open":
        this.openPath("/dashboard")
        return

      case "menu-autofill":
        this.openPath("/dashboard/autofill")
        return

      case "menu-logout":
        this.openPath("/logout")
        return

      case "open-job":
        this.openHireovenJob()
        return

      case "signin":
        this.openPath("/login")
        return

      default:
        return
    }
  }

  private renderDrawer(): string {
    if (this.drawer === "none") return ""

    const title = this.drawer === "autofill" ? "Autofill" : this.drawer === "tailor" ? "Tailor Resume" : "Cover Letter"
    const body =
      this.drawer === "autofill"
        ? this.renderAutofillBody()
        : this.drawer === "tailor"
          ? this.renderTailorBody()
          : this.renderCoverBody()
    const foot =
      this.drawer === "autofill"
        ? this.renderAutofillFoot()
        : this.drawer === "tailor"
          ? this.renderTailorFoot()
          : this.renderCoverFoot()

    return `
      <section class="drawer-shell" role="dialog" aria-label="${esc(title)}">
        <header class="drawer-head">
          <span class="drawer-icon"><img src="${BRAND_ICON_URL}" alt="Hireoven" /></span>
          <div class="drawer-title">${esc(title)}</div>
          <button class="drawer-close" data-action="close-drawer" aria-label="Close">×</button>
        </header>
        <div class="drawer-body">${body}</div>
        <footer class="drawer-foot">${foot}</footer>
      </section>
    `
  }

  private renderAutofillBody(): string {
    if (this.isBusy("autofill-load") && !this.autofillPreview) {
      return `<div class="muted">Detecting form fields...</div>`
    }

    const preview = this.autofillPreview
    if (!preview) {
      return `<div class="muted">No form detected on this page yet. Try opening the application form first.</div>`
    }

    if (preview.profileMissing) {
      return `<div class="muted">No autofill profile found yet. Set one up in your Hireoven dashboard, then come back.</div>`
    }

    if (this.autofillFilledCount != null) {
      const total = preview.totalFields || this.autofillFilledCount
      const requiredFilled = preview.fields.filter((f) => statusOfField(f) === "ready").length
      const optional = preview.fields.slice(0, 16).map((f) => {
        const s = statusOfField(f)
        const icon = s === "ready" ? "✓" : s === "review" ? "!" : "—"
        return `<div class="field-row"><span class="check ${s}">${icon}</span><span class="label">${esc(f.label || f.suggestedProfileKey || "Field")}</span><span class="meta">${esc(f.type)}</span></div>`
      }).join("")

      return `
        <div class="progress">
          <div class="progress-head"><span>${requiredFilled} OUT OF ${total} REQUIRED FIELDS FILLED</span><span>${total === 0 ? 100 : Math.round((requiredFilled / total) * 100)}%</span></div>
          <div class="progress-track"><div class="progress-fill" style="width:${total === 0 ? 100 : Math.min(100, Math.round((requiredFilled / total) * 100))}%"></div></div>
        </div>
        <div class="section-label">Fields</div>
        ${optional || `<div class="muted">No detail fields to show.</div>`}
        <div class="warn">Never auto-submitted. Review every value before clicking Submit.</div>
      `
    }

    const profileName = this.user?.fullName ?? this.user?.email ?? "Hireoven user"
    const coverPreview = this.coverLetterText.trim() ? trimText(this.coverLetterText, 90) : "Generate from the Cover Letter drawer first"

    const resumePickerHtml = this.renderResumePicker()
    const coverPreviewHtml = `
      <div class="section-label" style="margin-top:14px">Cover Letter</div>
      <div class="picker">
        <span class="picker-icon">✉️</span>
        <div class="picker-main">
          <div class="picker-title">${this.coverLetterText.trim() ? "Generated cover letter ready" : "No cover letter yet"}</div>
          <div class="picker-sub">${esc(coverPreview)}</div>
        </div>
      </div>
      <label class="toggle-row">
        <span class="label">Insert generated cover letter<small>Fills the cover-letter field on submit prep</small></span>
        <input type="checkbox" class="toggle" data-action="toggle-cover" ${this.autofillUseCover ? "checked" : ""} ${this.coverLetterText.trim() ? "" : "disabled"}/>
      </label>
    `

    return `
      <div class="section-label">Applicant Profile <span class="req">*Required</span></div>
      <div class="picker">
        <span class="picker-icon">👤</span>
        <div class="picker-main">
          <div class="picker-title">${esc(profileName)}</div>
          <div class="picker-sub">${esc(this.user?.email ?? "")}</div>
        </div>
        <span class="picker-tag">ACTIVE</span>
      </div>

      ${resumePickerHtml}
      ${coverPreviewHtml}

      <div class="warn">No auto-submit. We only fill — you click Submit.</div>
    `
  }

  private renderAutofillFoot(): string {
    const preview = this.autofillPreview
    if (this.autofillFilledCount != null) {
      return `
        <button class="btn primary" data-action="reload-autofill" ${this.isBusy("autofill-load") ? "disabled" : ""}>${this.isBusy("autofill-load") ? "Refreshing" : "Continue Autofill"}</button>
        <div class="credits">No fields are submitted automatically.</div>
      `
    }
    const safeCount = preview ? safeFieldsToFill(preview.fields).length : 0
    return `
      <button class="btn primary" data-action="fill-safe" ${!preview || safeCount === 0 || this.isBusy("autofill-fill") ? "disabled" : ""}>${this.isBusy("autofill-fill") ? "Filling..." : `Start Autofill (${safeCount})`}</button>
      <div class="credits">Credits left today: 5/5</div>
    `
  }

  private renderTailorBody(): string {
    if (this.isBusy("tailor-load") && !this.tailorPreview) return `<div class="muted">Loading tailor preview...</div>`
    const preview = this.tailorPreview
    if (!preview) return `<div class="muted">No preview available yet.</div>`

    const changes = preview.changesPreview.slice(0, 6).map((c) => `
      <div class="change">
        <div class="change-sec">${esc(c.section)}</div>
        <div class="change-text">${esc(trimText(c.after ?? c.reason ?? "", 220))}</div>
      </div>
    `).join("")

    return `
      <div class="muted">${esc(preview.summary)}</div>
      ${preview.matchScore == null ? "" : `<div class="stats"><span class="stat">${preview.matchScore}% match</span><span class="stat">${esc(preview.atsName ?? "ATS aware")}</span></div>`}
      ${changes ? `<div class="changes">${changes}</div>` : ""}
      ${this.approvedTailoredVersion ? `<div class="warn">Using tailored version: ${esc(this.approvedTailoredVersion)}</div>` : ""}
    `
  }

  private renderTailorFoot(): string {
    const preview = this.tailorPreview
    return `
      <button class="btn primary" data-action="approve-tailor" ${!preview || preview.status !== "ready" || this.isBusy("tailor-approve") ? "disabled" : ""}>${this.isBusy("tailor-approve") ? "Saving..." : "Use Tailored Resume"}</button>
      <button class="btn ghost" data-action="open-tailor-editor" style="margin-top:6px;width:100%">Open full editor</button>
    `
  }

  private renderCoverBody(): string {
    return `
      <div class="muted">Generated from this job — edit freely before inserting.</div>
      <textarea class="cover-text" data-role="cover-text">${esc(this.coverLetterText)}</textarea>
      <div class="warn">No auto-submit. Insertion only runs on explicit click.</div>
    `
  }

  private renderCoverFoot(): string {
    return `
      <button class="btn primary" data-action="insert-cover" ${!this.coverLetterText.trim() || this.isBusy("cover-insert") ? "disabled" : ""}>${this.isBusy("cover-insert") ? "Inserting..." : "Insert into form"}</button>
      <div style="display:flex;gap:6px;margin-top:8px">
        <button class="btn" style="flex:1" data-action="generate-cover" ${this.isBusy("cover-generate") ? "disabled" : ""}>${this.isBusy("cover-generate") ? "Generating..." : "Regenerate"}</button>
        <button class="btn" style="flex:1" data-action="copy-cover" ${!this.coverLetterText.trim() ? "disabled" : ""}>Copy</button>
      </div>
    `
  }

  private renderBarActions(): string {
    if (!this.authenticated) {
      return `<button class="action primary" data-action="signin">Sign in to Hireoven</button>`
    }

    // ── Application form — autofill is the hero action ────────────────────────
    if (this.mode === "application_form") {
      if (this.autofillFilledCount != null) {
        // Already filled — show re-check option
        return `
          <button class="action" data-action="reload-autofill" ${this.isBusy("autofill-load") ? "disabled" : ""}>
            ${this.isBusy("autofill-load") ? "Loading…" : "Re-check fields"}
          </button>
        `
      }
      return `
        <button class="action primary" data-action="autofill" ${this.isBusy("autofill-load") ? "disabled" : ""}>
          ${this.isBusy("autofill-load") ? "Detecting…" : "⚡ Autofill"}
        </button>
        <button class="action" data-action="tailor" ${this.isBusy("tailor-load") ? "disabled" : ""}>Tailor Resume</button>
        <button class="action" data-action="cover" ${this.isBusy("cover-generate") ? "disabled" : ""}>Cover Letter</button>
      `
    }

    // ── Job detail — research + prep actions ─────────────────────────────────
    if (this.mode === "job_detail") {
      const queue = this.queuePosition()
      const nextBtn = queue?.nextKey
        ? `<button class="action" data-action="queue-next" title="Next job in list">Next →</button>`
        : ""
      const autofillBtn = this.hasReachableForm
        ? `<button class="action primary" data-action="autofill" ${this.isBusy("autofill-load") ? "disabled" : ""}>Autofill</button>`
        : ""
      return `
        <button class="action" data-action="save" ${this.isBusy("save") ? "disabled" : ""}>Save</button>
        <button class="action" data-action="match" ${this.isBusy("match") ? "disabled" : ""}>
          ${this.isBusy("match") ? "Analyzing…" : "Match Score"}
        </button>
        <button class="action" data-action="tailor" ${this.isBusy("tailor-load") ? "disabled" : ""}>Tailor</button>
        <button class="action" data-action="cover" ${this.isBusy("cover-generate") ? "disabled" : ""}>Cover</button>
        ${autofillBtn}
        ${nextBtn}
      `
    }

    // ── Search results (LinkedIn, Glassdoor, Indeed) — filter + Scout ────────
    if (this.mode === "search_results") {
      const h1bOn = this.screenerFilters.h1bOnly
      const activeFilterCount = [
        this.screenerFilters.h1bOnly,
        this.screenerFilters.eVerifyOnly,
        this.screenerFilters.hideNoSponsor,
        this.screenerFilters.hideViewed,
      ].filter(Boolean).length

      return `
        <button class="action${h1bOn ? " primary" : ""}" data-action="toggle-h1b-filter" title="Show only H-1B sponsoring jobs">
          ${h1bOn ? "✓ H-1B" : "H-1B filter"}
        </button>
        ${activeFilterCount > 1 ? `<span class="pill queue">${activeFilterCount} filters</span>` : ""}
        <button class="action" data-action="open-dashboard">Open Scout →</button>
      `
    }

    return `<button class="action" data-action="open-dashboard">Open Hireoven</button>`
  }

  private renderMenu(): string {
    const name = this.user?.fullName ?? "Hireoven"
    const email = this.user?.email ?? ""
    return `
      <div class="menu" data-open="${this.profileOpen ? "true" : "false"}">
        <div class="menu-head">
          <div class="menu-name">${esc(name)}</div>
          <div class="menu-email">${esc(email)}</div>
        </div>
        <button class="menu-btn" data-action="menu-open">Open Hireoven</button>
        <button class="menu-btn" data-action="menu-autofill">Autofill profile</button>
        <button class="menu-btn" data-action="menu-logout">Logout</button>
      </div>
    `
  }

  private render(): void {
    if (!this.root) return

    const avatarUrl = this.resolveAvatarUrl(this.user?.avatarUrl)
    const avatar = avatarUrl
      ? `<img src="${esc(avatarUrl)}" alt="Profile" />`
      : esc(initials(this.user?.fullName, this.user?.email))

    this.root.innerHTML = `
      ${this.renderDrawer()}
      <div class="bar-wrap">
        <div class="bar" data-mode="${this.mode}" role="toolbar" aria-label="Hireoven command bar">
          <span class="brand" title="Hireoven"><img src="${BRAND_ICON_URL}" alt="Hireoven" /></span>
          <span class="title">${this.barTitleHtml()}</span>
          ${this.renderBarActions()}
          <button class="action icon" data-action="open-dashboard" aria-label="Open Hireoven">⌕</button>
          <button class="action icon" data-action="profile-toggle" aria-label="More">⋮</button>
          <button class="avatar" data-action="profile-toggle" aria-label="Profile menu">${avatar}</button>
        </div>
      </div>
      ${this.renderMenu()}
      ${this.statusLine ? `<div class="status">${esc(this.statusLine)}</div>` : ""}
    `

    const coverTextarea = this.root.querySelector<HTMLTextAreaElement>("[data-role='cover-text']")
    if (coverTextarea) {
      coverTextarea.addEventListener("input", () => {
        this.coverLetterText = coverTextarea.value
      })
    }

    this.root.querySelectorAll<HTMLElement>("[data-action]").forEach((node) => {
      const handler = (event: Event) => {
        event.preventDefault()
        event.stopPropagation()
        const action = node.dataset.action
        if (!action) return
        void this.onAction(action)
      }
      if (node instanceof HTMLSelectElement && node.dataset.action === "select-resume") {
        node.addEventListener("change", () => {
          this.selectedResumeId = node.value || null
          this.currentTailorResumeId = null
          this.approvedTailoredVersion = null
          this.render()
        })
      } else if (node instanceof HTMLInputElement && node.type === "checkbox") {
        node.addEventListener("change", handler)
      } else {
        node.addEventListener("click", handler)
      }
    })
  }
}
