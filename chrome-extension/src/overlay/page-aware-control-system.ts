import { sendToBackground } from "../bridge"
import { detectExtensionPageMode, detectPage } from "../detectors/ats"
import { extractJobWithMeta } from "../extractors/job"
import type {
  ApplyQueueState,
  AutofillExecuteResult,
  AutofillPreviewResult,
  CoverLetterResult,
  DetectedField,
  ExtensionJobFingerprint,
  ExtensionPageMode,
  ExtensionResumeSummary,
  ExtractedJob,
  ListResumesResult,
  QueueAddResult,
  QueueStateResult,
  ResolveJobResult,
  SaveResult,
  ScoutOverlayResult,
  SessionResult,
  TailorApproveResult,
  TailorPreviewResult,
} from "../types"
import {
  extractSiteContext,
  findDetailDescriptionRoot,
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
import { enrichFields, type AutofillIntelligenceResult } from "../autofill/intelligence"
import { FinalReviewPanel } from "./final-review-panel"
import { ApplyQueuePanel } from "./apply-queue-panel"
import { highlightKeywords } from "./keyword-highlighter"

/**
 * Inline Hireoven oven-mark icon — sourced from public/brand/hireoven-icon.svg.
 * Inlined so it works on external pages without web_accessible_resources restrictions.
 */
const BRAND_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" aria-hidden="true">
  <rect x="90" y="155" width="332" height="190" rx="40" fill="#062246" stroke="#00142d" stroke-width="10"/>
  <rect x="130" y="205" width="180" height="97" rx="12" fill="#b4260c" stroke="#ff7716" stroke-width="10"/>
  <rect x="160" y="176" width="132" height="18" rx="8" fill="#ffd24a" stroke="#ffee7f" stroke-width="6"/>
  <circle cx="366" cy="221" r="16" fill="#ebf3ff"/>
  <circle cx="366" cy="271" r="16" fill="#ebf3ff"/>
  <path d="M220 293 L185 262 L206 220 L218 252 L242 198 L271 242 L261 279 Z" fill="#ff9a2d"/>
  <path d="M228 291 L207 265 L224 237 L233 262 L249 228 L263 263 L253 289 Z" fill="#fff4cd"/>
  <line x1="190" y1="124" x2="224" y2="169" stroke="#ff9a2d" stroke-width="12" stroke-linecap="round"/>
  <line x1="256" y1="111" x2="256" y2="153" stroke="#ff9a2d" stroke-width="12" stroke-linecap="round"/>
  <line x1="321" y1="124" x2="287" y2="169" stroke="#ff9a2d" stroke-width="12" stroke-linecap="round"/>
</svg>`

interface PageAwareOptions {
  resolveAppOrigin: () => Promise<string>
}

type DrawerMode = "none" | "autofill" | "tailor" | "cover" | "review"
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
  | "queue-add"

interface CardInsights {
  matchPercent: number | null
  sponsorshipLikely: boolean | null
  sponsorshipLabel: string | null
  missingSkills: string[]
}

interface CardMemory {
  canonicalId: string
  savedJobId: string | null
  resolving:  boolean  // silently checking DB
  saving:     boolean  // user-triggered save in progress
  insights:   CardInsights | null
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
    min-height: 60px;
    max-width: min(720px, calc(100vw - 24px));
    border-radius: 999px;
    border: 1px solid rgba(15, 23, 42, 0.6);
    background: #0b1220;
    box-shadow: 0 14px 36px rgba(2, 6, 23, 0.5);
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 8px;
    overflow: hidden;
  }

  .brand {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 42px;
    height: 42px;
    border-radius: 999px;
    background: #FF5C18;
    flex: 0 0 auto;
    overflow: hidden;
    box-shadow: 0 0 0 2px rgba(255, 92, 24, 0.35), inset 0 0 0 1.5px rgba(255, 255, 255, 0.22);
    transition: background 200ms ease;
  }

  .brand svg {
    width: 20px;
    height: 20px;
    display: block;
    flex-shrink: 0;
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

  /* The large autofill button — theme orange, fills available space */
  .autofill-btn {
    flex: 1 1 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: 42px;
    border-radius: 999px;
    border: none;
    background: #FF5C18;
    color: #ffffff;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    padding: 0 20px;
    white-space: nowrap;
    transition: background 150ms ease, opacity 150ms ease;
    min-width: 180px;
  }

  .autofill-btn:hover:not(:disabled) {
    background: #e0511a;
  }

  .autofill-btn:disabled {
    opacity: 0.7;
    cursor: default;
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
    width: 38px;
    height: 38px;
    border-radius: 999px;
    border: 1px solid rgba(148, 163, 184, 0.3);
    background: #0f172a;
    color: #f8fafc;
    font-size: 13px;
    font-weight: 700;
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

  .drawer-icon svg {
    width: 18px;
    height: 18px;
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

  /* ── Flat field rows ─────────────────────────────── */
  .fr-list {
    display: flex;
    flex-direction: column;
    gap: 1px;
    margin-bottom: 12px;
  }

  .fr-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 4px;
    border-bottom: 1px solid #f8fafc;
  }

  .fr-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .fr-dot.ready     { background: #22c55e; }
  .fr-dot.review    { background: #f59e0b; }
  .fr-dot.sensitive { background: #ef4444; }
  .fr-dot.missing   { background: #cbd5e1; }
  .fr-dot.upload    { background: #94a3b8; }

  .fr-label {
    font-size: 11px;
    font-weight: 600;
    color: #475569;
    flex: 0 0 100px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .fr-value {
    font-size: 11px;
    color: #0f172a;
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .fr-value.muted { color: #94a3b8; font-style: italic; }

  /* ── Post-fill result rows ───────────────────────── */
  .fill-result-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .fill-result-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border-radius: 8px;
  }

  .fill-result-row.filled   { background: rgba(34,197,94,0.07); }
  .fill-result-row.failed   { background: rgba(239,68,68,0.07); }
  .fill-result-row.sensitive{ background: rgba(245,158,11,0.07); }

  .fill-result-icon {
    font-size: 12px;
    font-weight: 700;
    flex-shrink: 0;
    width: 14px;
    text-align: center;
  }

  .fill-result-row.filled   .fill-result-icon { color: #16a34a; }
  .fill-result-row.failed   .fill-result-icon { color: #dc2626; }
  .fill-result-row.sensitive .fill-result-icon{ color: #d97706; }

  .fill-result-label {
    font-size: 11px;
    font-weight: 600;
    color: #334155;
    flex: 1;
  }

  .fill-result-note {
    font-size: 10px;
    color: #94a3b8;
    flex-shrink: 0;
  }

  .fill-result-row.failed .fill-result-note { color: #dc2626; }

  /* ── Resume + Cover Letter sidebar sections ─────── */
  .sidebar-sections-wrap {
    display: flex;
    flex-direction: column;
    gap: 8px;
    border-top: 1px solid #f1f5f9;
    padding-top: 10px;
  }

  .sidebar-section {
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    overflow: hidden;
    background: #fff;
  }

  .sidebar-section-head {
    font-size: 11px;
    font-weight: 700;
    color: #64748b;
    background: #f8fafc;
    padding: 7px 12px;
    border-bottom: 1px solid #f1f5f9;
    letter-spacing: 0.02em;
  }

  .sidebar-section-body {
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .sidebar-section-name {
    font-size: 12px;
    font-weight: 600;
    color: #1e293b;
  }

  .sidebar-section-preview {
    font-size: 11px;
    color: #64748b;
    line-height: 1.5;
    max-height: 54px;
    overflow: hidden;
  }

  .sidebar-section-status {
    font-size: 11px;
    font-weight: 600;
  }

  .sidebar-section-status.done { color: #FF5C18; }

  .sidebar-action-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 30px;
    border-radius: 8px;
    border: 1.5px solid #FF5C18;
    background: transparent;
    color: #FF5C18;
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
    padding: 0 14px;
    transition: background 150ms ease;
    align-self: flex-start;
  }

  .sidebar-action-btn:hover:not(:disabled) {
    background: rgba(255, 92, 24, 0.06);
  }

  .sidebar-action-btn:disabled {
    opacity: 0.55;
    cursor: default;
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

  /* ── Autofill Intelligence styles ──────────────────────────────────── */

  .intel-strip {
    display: flex;
    flex-direction: column;
    gap: 6px;
    border-radius: 10px;
    border: 1px solid rgba(255, 92, 24, 0.22);
    background: rgba(255, 92, 24, 0.06);
    padding: 10px 12px;
    margin-bottom: 12px;
  }

  .intel-strip .summary {
    font-size: 12px;
    font-weight: 650;
    color: #c94010;
    line-height: 1.4;
  }

  .intel-counts {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .intel-count {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-size: 10px;
    font-weight: 700;
    padding: 2px 7px;
    border-radius: 999px;
    white-space: nowrap;
  }

  .intel-count.ready   { background: #f0fdf4; color: #166534; border: 1px solid #bbf7d0; }
  .intel-count.review  { background: #fffbeb; color: #92400e; border: 1px solid #fde68a; }
  .intel-count.missing { background: #f8fafc; color: #475569; border: 1px solid #e2e8f0; }
  .intel-count.sensitive { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; }

  .field-section {
    margin-bottom: 10px;
  }

  .field-section-head {
    font-size: 10px;
    font-weight: 720;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    padding: 6px 0 4px;
    border-bottom: 1px solid #f1f5f9;
    margin-bottom: 4px;
    display: flex;
    align-items: center;
    gap: 5px;
  }

  .field-section-head.ready    { color: #15803d; }
  .field-section-head.review   { color: #b45309; }
  .field-section-head.sensitive { color: #dc2626; }
  .field-section-head.missing  { color: #64748b; }
  .field-section-head.upload   { color: #64748b; }

  .ifield-row {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 6px 0;
    border-bottom: 1px solid #f8fafc;
  }

  .ifield-row:last-child { border-bottom: none; }

  .ifield-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
    margin-top: 5px;
  }

  .ifield-dot.ready    { background: #22c55e; }
  .ifield-dot.review   { background: #f59e0b; }
  .ifield-dot.sensitive { background: #ef4444; }
  .ifield-dot.missing  { background: #cbd5e1; }
  .ifield-dot.upload   { background: #94a3b8; }

  .ifield-content {
    flex: 1;
    min-width: 0;
  }

  .ifield-label {
    font-size: 11px;
    font-weight: 650;
    color: #0f172a;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .ifield-value {
    font-size: 11px;
    color: #475569;
    margin-top: 1px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .ifield-value.empty { color: #94a3b8; font-style: italic; }

  .ifield-note {
    font-size: 10px;
    color: #92400e;
    margin-top: 3px;
    line-height: 1.4;
  }

  .ifield-note.sensitive { color: #dc2626; }

  .ifield-source {
    font-size: 9px;
    font-weight: 700;
    padding: 1px 5px;
    border-radius: 4px;
    flex-shrink: 0;
    margin-top: 3px;
  }

  .ifield-source.profile      { background: #f0f9ff; color: #0369a1; }
  .ifield-source.cover_letter { background: #faf5ff; color: #7c3aed; }
  .ifield-source.manual       { background: #f8fafc; color: #64748b; }

  .intel-warn-strip {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    border-radius: 8px;
    border: 1px solid #fde68a;
    background: #fffbeb;
    padding: 8px 10px;
    margin-bottom: 8px;
    font-size: 11px;
    color: #92400e;
    line-height: 1.4;
  }

  .intel-warn-strip.blocker {
    border-color: #fecaca;
    background: #fef2f2;
    color: #991b1b;
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

  .frog svg {
    width: 12px;
    height: 12px;
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
      <span class="frog" title="Hireoven">${BRAND_ICON_SVG}</span>
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

const COVER_LETTER_SCAN_PATTERNS = [
  /cover[_\s-]?letter/i,
  /coverletter/i,
  /letter[_\s-]?of[_\s-]?interest/i,
  /personal[_\s-]?statement/i,
  /motivat/i,
  /why[_\s-]?do[_\s-]?you[_\s-]?want/i,
  /additional[_\s-]?information/i,
  /tell[_\s-]?us[_\s-]?more/i,
  /anything[_\s-]?else/i,
]

/**
 * DOM scan for a cover letter text input when no cached elementRef is available.
 * Returns a CSS selector that can locate the field, or null if none found.
 */
function findCoverLetterFieldRef(): string | null {
  // 1. Try textarea elements
  const textareas = Array.from(document.querySelectorAll<HTMLTextAreaElement>("textarea"))
  for (const ta of textareas) {
    const combined = [
      ta.id,
      ta.name,
      ta.getAttribute("aria-label") ?? "",
      ta.placeholder,
      document.querySelector(`label[for="${ta.id}"]`)?.textContent ?? "",
    ].join(" ").toLowerCase()

    if (COVER_LETTER_SCAN_PATTERNS.some((p) => p.test(combined))) {
      if (ta.id) return `#${CSS.escape(ta.id)}`
      if (ta.name) return `textarea[name="${ta.name}"]`
      const idx = textareas.indexOf(ta)
      return `textarea:nth-of-type(${idx + 1})`
    }
  }

  // 2. Try contenteditable divs (used by Quill/TipTap/Draft.js in some ATS)
  const editables = Array.from(document.querySelectorAll<HTMLElement>('[contenteditable="true"],[contenteditable=""]'))
  for (const el of editables) {
    const ariaLabel = el.getAttribute("aria-label") ?? ""
    const placeholder = el.getAttribute("data-placeholder") ?? el.getAttribute("placeholder") ?? ""
    const combined = [ariaLabel, placeholder, el.id].join(" ").toLowerCase()

    if (COVER_LETTER_SCAN_PATTERNS.some((p) => p.test(combined))) {
      if (el.id) return `#${CSS.escape(el.id)}`
      // Use a data attribute as a unique anchor
      const unique = `ho-cl-target-${Date.now()}`
      el.setAttribute("data-ho-cl", unique)
      return `[data-ho-cl="${unique}"]`
    }
  }

  // 3. Heuristic: largest textarea on the form (often the cover letter/additional info)
  if (textareas.length > 0) {
    const largest = textareas.reduce((best, ta) => {
      const rows = parseInt(ta.getAttribute("rows") ?? "0", 10)
      const bestRows = parseInt(best.getAttribute("rows") ?? "0", 10)
      return rows > bestRows ? ta : best
    })
    if (largest.id) return `#${CSS.escape(largest.id)}`
    if (largest.name) return `textarea[name="${largest.name}"]`
    const idx = textareas.indexOf(largest)
    return `textarea:nth-of-type(${idx + 1})`
  }

  return null
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
  private finalReviewPanel: FinalReviewPanel | null = null
  private matchPanel: MatchDetailPanel | null = null
  private readonly autoMatchTriggered = new Set<string>()
  private autoMatchTimer: number | null = null

  private resumeList: ExtensionResumeSummary[] = []
  private resumeListLoading = false
  private selectedResumeId: string | null = null

  private autofillPreview: AutofillPreviewResult | null = null
  private fieldIntelligence: AutofillIntelligenceResult | null = null
  private autofillFilledCount: number | null = null
  private autofillFieldResults: Array<{ label: string; filled: boolean; sensitive?: boolean }> = []
  private autofillUseTailored = true
  private autofillUseCover = true
  private tailorPreview: TailorPreviewResult | null = null
  private coverLetterText = ""
  private coverLetterFieldRef: string | null = null
  private approvedTailoredVersion: string | null = null
  private currentTailorResumeId: string | null = null

  private readonly busy = new Set<BusyAction>()

  // ── Apply Queue ──────────────────────────────────────────────────────────────
  private queueState: ApplyQueueState | null = null
  private queuePanel: ApplyQueuePanel | null = null

  // Tracks whether ensureResumeList has been called at least once this session
  private resumeListFetched = false

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
    void this.refreshQueueState()

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
    this.queuePanel?.unmount()
    this.queuePanel = null

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
      resolving:  false,
      saving:     false,
      insights:   null,
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

    // Pre-fetch resume list when on a page where Tailor eligibility matters,
    // so the Tailor button shows the correct enabled/disabled state without
    // waiting for the drawer to open.
    if (
      this.authenticated &&
      !this.resumeListFetched &&
      !this.resumeListLoading &&
      (this.mode === "job_detail" || this.mode === "application_form")
    ) {
      void this.ensureResumeList()
    }

    const showResultBadges = resultCards.length > 0 && (siteContext.isSearchPage || this.mode === "search_results")
    this.syncBadges(showResultBadges ? resultCards : [])
    this.syncScreenerPanel(showResultBadges ? resultCards : [], siteContext.site)
    this.syncMatchPanel(detailCard, siteContext.site)

    if (this.activeCardKey && !this.cardsByKey.has(this.activeCardKey)) {
      this.activeCardKey = null
    }

    // Silently check DB on every scan — never saves automatically.
    // Sets memory.savedJobId if found, which switches the bar to show Autofill.
    if (
      this.authenticated &&
      this.activeJob &&
      (this.mode === "job_detail" || this.mode === "application_form")
    ) {
      const canonicalId = this.activeCanonicalId()
      if (canonicalId) {
        void this.autoCheckJob(canonicalId, this.activeJob)
      }
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
      this.resumeListFetched = true
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

  /**
   * Silent check — resolves whether this job is already in Hireoven DB.
   * Sets memory.savedJobId if found. Never saves. Called automatically on scan.
   */
  private async autoCheckJob(canonicalId: string, job: ExtractedJob): Promise<void> {
    const memory = this.ensureMemory(canonicalId)
    if (memory.savedJobId || memory.resolving || memory.saving) return

    memory.resolving = true
    try {
      const fingerprint = this.activeFingerprint(job)
      const raw = await sendToBackground({ type: "RESOLVE_JOB", fingerprint })
      const resolved = raw as ResolveJobResult
      if (resolved.exists && resolved.jobId) {
        memory.savedJobId = resolved.jobId
      }
    } catch {
      // network error — will retry on next scan
    } finally {
      memory.resolving = false
      this.render()
    }
  }

  /**
   * Triggered by user clicking "Save Job".
   * Saves the job to Hireoven (company creation + full import).
   */
  private async resolveOrSaveJob(canonicalId: string, job: ExtractedJob): Promise<string | null> {
    const memory = this.ensureMemory(canonicalId)
    if (memory.savedJobId) return memory.savedJobId
    if (memory.saving) return null

    memory.saving = true
    this.render()

    try {
      // Check once more — may have been saved in another tab
      const fingerprint = this.activeFingerprint(job)
      try {
        const resolveRaw = await sendToBackground({ type: "RESOLVE_JOB", fingerprint })
        const resolved = resolveRaw as ResolveJobResult
        if (resolved.exists && resolved.jobId) {
          memory.savedJobId = resolved.jobId
          return resolved.jobId
        }
      } catch { /* fall through to save */ }

      const saveRaw = await sendToBackground({ type: "SAVE_JOB", job: this.activeJobPayload(job) })
      const saved = saveRaw as SaveResult
      if (saved.saved && saved.jobId) {
        memory.savedJobId = saved.jobId
        return saved.jobId
      }
      return null
    } finally {
      memory.saving = false
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
      this.setStatus("Could not save this job. Try again.")
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

          // Highlight missing keywords in the active detail card's JD text
          const activeCard = this.activeCard()
          if (activeCard) {
            const descRoot = findDetailDescriptionRoot(activeCard)
            if (descRoot && result.missingSkills?.length) {
              highlightKeywords(descRoot, [], result.missingSkills)
            }
          }

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
    this.autofillFieldResults = []
    this.fieldIntelligence = null
    this.render()

    void this.ensureResumeList()

    await this.runBusy("autofill-load", async () => {
      try {
        const raw = await sendToBackground({ type: "GET_AUTOFILL_PREVIEW" })
        this.autofillPreview = raw as AutofillPreviewResult
        this.fieldIntelligence = enrichFields(this.autofillPreview.fields)

        // Try to find cover letter field from preview first, then fall back to DOM scan
        const coverFieldFromPreview = this.autofillPreview.fields.find(
          (f) => f.suggestedProfileKey === "cover_letter_text" || f.suggestedProfileKey === "cover_letter",
        )
        this.coverLetterFieldRef = coverFieldFromPreview?.elementRef ?? findCoverLetterFieldRef()

        const c = this.fieldIntelligence.counts
        this.setStatus(`${c.ready} ready · ${c.review} review · ${c.sensitive} sensitive`)
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

  /** Tailor resume inline inside the autofill drawer — no drawer switch. */
  private async inlineTailorResume(): Promise<void> {
    const jobId = await this.ensureActiveJobId()
    if (!jobId) { this.setStatus("Save this job first to tailor your resume."); return }

    await this.runBusy("tailor-load", async () => {
      try {
        const previewRaw = await sendToBackground({
          type:     "GET_TAILOR_PREVIEW",
          jobId,
          resumeId: this.effectiveResumeId(),
          ats:      this.activeJob?.ats,
        })
        this.tailorPreview = previewRaw as TailorPreviewResult
        this.currentTailorResumeId = this.tailorPreview.resumeId ?? this.currentTailorResumeId
      } catch {
        this.setStatus("Could not load tailor preview.")
        return
      }
    })

    if (!this.tailorPreview || this.tailorPreview.status === "missing_job_context" || this.tailorPreview.status === "missing_resume") {
      this.setStatus("Not enough context to tailor resume.")
      return
    }

    await this.runBusy("tailor-approve", async () => {
      try {
        const approveRaw = await sendToBackground({
          type:     "APPROVE_TAILORED_RESUME",
          jobId,
          resumeId: this.effectiveResumeId(),
          ats:      this.activeJob?.ats,
        })
        const approved = approveRaw as TailorApproveResult
        if (approved.success && approved.resumeId) {
          this.currentTailorResumeId = approved.resumeId
          this.approvedTailoredVersion = approved.versionName ?? "Tailored version"
          this.setStatus("Resume tailored — click Fill to attach it.")
        } else {
          this.setStatus(approved.error ?? "Could not tailor resume.")
        }
      } catch {
        this.setStatus("Could not tailor resume.")
      }
    })
  }

  /**
   * One-click autofill:
   *   Phase 1 (blocking): detect form fields → fill immediately
   *   Phase 2 (background): generate cover letter + tailor resume → inject when ready
   */
  private openFinalReviewPanel(): void {
    if (!this.authenticated) { this.openPath("/login"); return }

    this.finalReviewPanel?.unmount()
    this.finalReviewPanel = new FinalReviewPanel({
      initialState: {
        jobTitle:              this.activeJob?.title ?? null,
        company:               this.activeJob?.company ?? null,
        applyUrl:              window.location.href,
        autofill:              this.fieldIntelligence ?? undefined,
        resumeReady:           false,
        coverLetterReady:      false,
        sensitiveAcknowledged: false,
      },
      appOrigin: this.appOrigin,
      onOpenAutofill: () => {
        this.finalReviewPanel?.unmount()
        this.finalReviewPanel = null
        void this.openAutofillDrawer()
      },
      onMarkSubmitted: async (jobId?: string) => {
        try {
          await fetch(`${this.appOrigin}/api/scout/mark-submitted`, {
            method:       "POST",
            credentials:  "include",
            headers:      { "Content-Type": "application/json" },
            body:         JSON.stringify({
              jobId:       jobId,
              jobTitle:    this.activeJob?.title,
              companyName: this.activeJob?.company,
              applyUrl:    window.location.href,
            }),
          })
        } catch {}
      },
      onClose: () => {
        this.finalReviewPanel?.unmount()
        this.finalReviewPanel = null
      },
    })
    this.finalReviewPanel.mount()

    // Pass the latest autofill intelligence if already loaded
    if (this.fieldIntelligence) {
      this.finalReviewPanel.updateAutofill(this.fieldIntelligence)
    }
  }

  private async fillSafeFields(): Promise<void> {
    const preview = this.autofillPreview
    if (!preview) return

    const safe         = safeFieldsToFill(preview.fields)
    const canFillCover = this.autofillUseCover && Boolean(this.coverLetterText.trim()) && Boolean(this.coverLetterFieldRef)
    const resumeId     = this.effectiveResumeId()

    if (safe.length === 0 && !canFillCover && !resumeId) {
      this.setStatus("No fields to fill yet.")
      return
    }

    await this.runBusy("autofill-fill", async () => {
      try {
        const fieldResults: Array<{ label: string; filled: boolean; sensitive?: boolean }> = []
        let filledCount = 0

        // ── Form fields ───────────────────────────────────────────────────────
        if (safe.length > 0) {
          const raw    = await sendToBackground({ type: "EXECUTE_AUTOFILL", fields: safe })
          const result = raw as AutofillExecuteResult

          // Map results back to field labels using index order
          safe.forEach((field, i) => {
            const filled = i < result.filledCount
            const intel  = this.fieldIntelligence?.fields.find((f) => f.elementRef === field.elementRef)
            fieldResults.push({ label: intel?.label ?? field.elementRef, filled })
            if (filled) filledCount++
          })

          // Sensitive / skipped fields — mark as not filled with context
          const intel = this.fieldIntelligence
          if (intel) {
            intel.fields
              .filter((f) => f.status === "sensitive")
              .forEach((f) => fieldResults.push({ label: f.label ?? f.profileKey ?? "Field", filled: false, sensitive: true }))
          }
        }

        // ── Cover letter ──────────────────────────────────────────────────────
        if (canFillCover && this.coverLetterFieldRef) {
          try {
            await sendToBackground({ type: "FILL_COVER_LETTER", elementRef: this.coverLetterFieldRef, text: this.coverLetterText })
            fieldResults.push({ label: "Cover Letter", filled: true })
            filledCount++
          } catch {
            fieldResults.push({ label: "Cover Letter", filled: false })
          }
        }

        // ── Resume file injection ─────────────────────────────────────────────
        if (resumeId) {
          try {
            const injectRaw = await sendToBackground({ type: "INJECT_RESUME_FILE_IN_TAB", resumeId })
            const injected  = (injectRaw as import("../types").InjectResumeFileInTabResult)?.injected ?? false
            fieldResults.push({ label: "Resume", filled: injected })
            if (injected) filledCount++
          } catch {
            fieldResults.push({ label: "Resume", filled: false })
          }
        }

        this.autofillFilledCount  = filledCount
        this.autofillFieldResults = fieldResults
        this.setStatus(`${filledCount} of ${fieldResults.length} filled.`)
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
          this.approvedTailoredVersion = result.versionName ?? "Tailored version"
          this.currentTailorResumeId = result.resumeId ?? this.currentTailorResumeId
          this.setStatus("Tailored version saved. Download it to attach to this form.")
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

    // 1. Try cached ref from autofill preview
    if (!this.coverLetterFieldRef) {
      const field = this.autofillPreview?.fields.find((item) => item.suggestedProfileKey === "cover_letter_text")
      this.coverLetterFieldRef = field?.elementRef ?? null
    }

    // 2. Fallback: scan the live DOM for a cover letter textarea/contenteditable
    if (!this.coverLetterFieldRef) {
      this.coverLetterFieldRef = findCoverLetterFieldRef()
    }

    if (!this.coverLetterFieldRef) {
      this.setStatus("No cover letter field found on this page. Navigate to the application form first.")
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
        await this.openAutofillDrawer()
        return

      case "review-fields":
        await this.openAutofillDrawer()
        return

      case "inline-tailor":
        await this.inlineTailorResume()
        return

      case "tailor":
        await this.openTailorDrawer()
        return

      case "cover":
        await this.openCoverDrawer()
        return

      case "review-final":
        this.openFinalReviewPanel()
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

      case "open-apply-url": {
        const applyUrl = this.activeApplyUrl()
        if (applyUrl) window.open(applyUrl, "_blank", "noopener")
        return
      }

      case "queue-add-active":
        await this.addActiveJobToQueue()
        return

      case "open-queue":
        this.openQueuePanel()
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

  // ── Apply Queue methods ──────────────────────────────────────────────────────

  private async refreshQueueState(): Promise<void> {
    try {
      const raw = await sendToBackground({ type: "QUEUE_GET_STATE" })
      const result = raw as QueueStateResult
      if (result.type === "QUEUE_STATE_RESULT") {
        this.queueState = result.queue
        if (this.queuePanel?.isOpen) this.queuePanel.update(this.queueState)
        this.render()
      }
    } catch {
      // ignore
    }
  }

  private async addActiveJobToQueue(): Promise<void> {
    if (!this.authenticated) { this.openPath("/login"); return }

    const job = this.activeJob
    if (!job?.url) {
      this.setStatus("No job context found on this page.")
      return
    }

    await this.runBusy("queue-add", async () => {
      const jobId = await this.ensureActiveJobId()
      const raw = await sendToBackground({
        type: "QUEUE_ADD_JOB",
        job: {
          jobId: jobId ?? null,
          jobTitle: job.title ?? "Unknown role",
          company: job.company ?? null,
          applyUrl: job.applyUrl ?? job.url,
          matchScore: (this.activeCanonicalId()
            ? this.memoryByCanonical.get(this.activeCanonicalId()!)?.insights?.matchPercent ?? null
            : null),
          sponsorshipSignal: job.sponsorshipSignal ?? null,
        },
      })
      const result = raw as QueueAddResult
      if (result.type === "QUEUE_ADD_RESULT") {
        if (result.failReason) {
          this.setStatus(`Cannot queue: ${result.failReason}`)
        } else {
          this.setStatus("Added to apply queue.")
          await this.refreshQueueState()
        }
      }
    })
  }

  private openQueuePanel(): void {
    if (!this.queuePanel) {
      this.queuePanel = new ApplyQueuePanel({
        onSkip: (queueId) => void this.queueDoSkip(queueId),
        onRetry: (queueId) => void this.queueDoRetry(queueId),
        onOpen: (queueId) => void this.queueDoOpen(queueId),
        onPause: () => void this.queueDoPause(true),
        onResume: () => void this.queueDoPause(false),
        onClear: () => void this.queueDoClear(),
        onClose: () => {
          this.queuePanel?.unmount()
          this.render()
        },
      })
    }
    this.queuePanel.mount(this.queueState)
    void this.refreshQueueState()
  }

  private async queueDoSkip(queueId: string): Promise<void> {
    await sendToBackground({ type: "QUEUE_SKIP_JOB", queueId })
    await this.refreshQueueState()
  }

  private async queueDoRetry(queueId: string): Promise<void> {
    await sendToBackground({ type: "QUEUE_RETRY_JOB", queueId })
    await this.refreshQueueState()
    // Poll briefly for preparation status
    setTimeout(() => void this.refreshQueueState(), 3000)
    setTimeout(() => void this.refreshQueueState(), 8000)
  }

  private async queueDoOpen(queueId: string): Promise<void> {
    const job = this.queueState?.jobs.find((j) => j.queueId === queueId)
    if (!job?.applyUrl) return
    // Open the apply URL — content scripts use window.open
    window.open(job.applyUrl, "_blank", "noopener")
    this.setStatus(`Opening ${job.jobTitle ?? "job"}…`)
    await this.refreshQueueState()
  }

  private async queueDoPause(pause: boolean): Promise<void> {
    await sendToBackground({ type: pause ? "QUEUE_PAUSE" : "QUEUE_RESUME" })
    await this.refreshQueueState()
  }

  private async queueDoClear(): Promise<void> {
    await sendToBackground({ type: "QUEUE_CLEAR" })
    await this.refreshQueueState()
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
          <span class="drawer-icon">${BRAND_ICON_SVG}</span>
          <div class="drawer-title">${esc(title)}</div>
          <button class="drawer-close" data-action="close-drawer" aria-label="Close">×</button>
        </header>
        <div class="drawer-body">${body}</div>
        <footer class="drawer-foot">${foot}</footer>
      </section>
    `
  }

  // ── Intelligence field rendering helpers ─────────────────────────────────



  private renderAutofillBody(): string {
    if (this.isBusy("autofill-load") && !this.autofillPreview) {
      return `<div class="muted">Scanning form fields…</div>`
    }

    const preview = this.autofillPreview
    if (!preview) {
      return `<div class="muted">No application form detected. Make sure you're on an application page.</div>`
    }
    if (preview.profileMissing) {
      return `<div class="muted">No autofill profile found. Set one up in Hireoven first.</div>`
    }

    const intel = this.fieldIntelligence
    if (!intel) {
      return `<div class="muted">Analyzing fields…</div>`
    }

    // ── Post-fill: show per-field results ──────────────────────────────────
    if (this.autofillFilledCount != null && this.autofillFieldResults.length > 0) {
      const rows = this.autofillFieldResults.map((r) => `
        <div class="fill-result-row ${r.filled ? "filled" : r.sensitive ? "sensitive" : "failed"}">
          <span class="fill-result-icon">${r.filled ? "✓" : r.sensitive ? "⛔" : "✗"}</span>
          <span class="fill-result-label">${esc(r.label)}</span>
          ${!r.filled ? `<span class="fill-result-note">${r.sensitive ? "Fill manually" : "Couldn't fill"}</span>` : ""}
        </div>
      `).join("")
      return `
        <div class="fill-result-list">${rows}</div>
      `
    }

    // ── Field list ─────────────────────────────────────────────────────────
    const allFields = intel.fields
    const fieldRows = allFields.map((f) => {
      const statusIcon =
        f.status === "ready"        ? `<span class="fr-dot ready"></span>` :
        f.status === "review_needed"? `<span class="fr-dot review"></span>` :
        f.status === "sensitive"    ? `<span class="fr-dot sensitive"></span>` :
        f.status === "missing_data" ? `<span class="fr-dot missing"></span>` :
                                      `<span class="fr-dot upload"></span>`
      const valueHtml = f.value
        ? `<span class="fr-value">${esc(trimText(f.value, 32))}</span>`
        : f.status === "sensitive"
          ? `<span class="fr-value muted">Fill manually</span>`
          : f.status === "missing_data"
            ? `<span class="fr-value muted">Not in profile</span>`
            : `<span class="fr-value muted">—</span>`

      return `
        <div class="fr-row">
          ${statusIcon}
          <span class="fr-label">${esc(f.label || f.profileKey || "Field")}</span>
          ${valueHtml}
        </div>
      `
    }).join("")

    const fieldSection = allFields.length > 0
      ? `<div class="fr-list">${fieldRows}</div>`
      : `<div class="muted">No fillable fields detected on this page.</div>`

    // ── Resume section ─────────────────────────────────────────────────────
    const isTailoring  = this.isBusy("tailor-load") || this.isBusy("tailor-approve")
    const tailorDone   = Boolean(this.currentTailorResumeId)
    const resumeName   = this.tailorPreview?.resumeName ?? "Your resume"

    const resumeSection = `
      <div class="sidebar-section">
        <div class="sidebar-section-head">📄 Resume</div>
        <div class="sidebar-section-body">
          <div class="sidebar-section-name">${esc(resumeName)}</div>
          ${tailorDone
            ? `<div class="sidebar-section-status done">✓ Tailored for this role</div>`
            : `<button class="sidebar-action-btn" data-action="inline-tailor" ${isTailoring ? "disabled" : ""}>
                 ${isTailoring ? "Tailoring…" : "Tailor Resume"}
               </button>`
          }
        </div>
      </div>
    `

    // ── Cover letter section (only if field detected) ──────────────────────
    const isCoverGenerating = this.isBusy("cover-generate")
    const coverDone         = Boolean(this.coverLetterText.trim()) && Boolean(this.coverLetterFieldRef)
    const coverFieldPresent = Boolean(this.coverLetterFieldRef)

    const coverSection = coverFieldPresent ? `
      <div class="sidebar-section">
        <div class="sidebar-section-head">✉️ Cover Letter</div>
        <div class="sidebar-section-body">
          ${coverDone
            ? `<div class="sidebar-section-preview">${esc(trimText(this.coverLetterText, 120))}</div>
               <div class="sidebar-section-status done">✓ Ready to insert</div>`
            : `<div class="sidebar-section-name">Field detected on this page</div>
               <button class="sidebar-action-btn" data-action="cover" ${isCoverGenerating ? "disabled" : ""}>
                 ${isCoverGenerating ? "Generating…" : "Generate Cover Letter"}
               </button>`
          }
        </div>
      </div>
    ` : ""

    return `
      ${fieldSection}
      <div class="sidebar-sections-wrap">
        ${resumeSection}
        ${coverSection}
      </div>
    `
  }

  private renderAutofillFoot(): string {
    const preview = this.autofillPreview
    const intel = this.fieldIntelligence

    if (this.autofillFilledCount != null) {
      return `
        <button class="btn primary" data-action="reload-autofill" ${this.isBusy("autofill-load") ? "disabled" : ""}>
          ${this.isBusy("autofill-load") ? "Re-scanning…" : "Re-check fields"}
        </button>
        <div class="credits">No fields are submitted automatically.</div>
      `
    }

    const safeCount  = preview ? safeFieldsToFill(preview.fields).length : 0
    const coverReady = Boolean(this.coverLetterText.trim()) && Boolean(this.coverLetterFieldRef)
    const resumeReady = Boolean(this.effectiveResumeId())
    const hasSensitive = (intel?.counts.sensitive ?? 0) > 0
    const canFill = Boolean(preview) && (safeCount > 0 || coverReady || resumeReady)
    const isFilling = this.isBusy("autofill-fill")

    return `
      <button class="btn primary" data-action="fill-safe"
        style="width:100%;justify-content:center;font-size:14px;padding:12px;"
        ${!canFill || isFilling ? "disabled" : ""}>
        ${isFilling ? "Filling…" : "Autofill"}
      </button>
      ${canFill && !isFilling
        ? `<div class="credits" style="text-align:center;margin-top:6px;">
             ${hasSensitive ? `⚠ ${intel!.counts.sensitive} sensitive field${intel!.counts.sensitive > 1 ? "s" : ""} skipped — fill manually` : "Review every field before submitting"}
           </div>`
        : ""
      }
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

    if (this.approvedTailoredVersion) {
      // Show download link so user can grab the PDF and attach it manually
      const versionId = this.currentTailorResumeId ?? ""
      const downloadUrl = `${this.appOrigin}/api/resume/download?resumeId=${encodeURIComponent(versionId)}&versionName=${encodeURIComponent(this.approvedTailoredVersion)}`
      return `
        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:10px 12px;margin-bottom:8px">
          <div style="font-size:11px;font-weight:700;color:#166534;margin-bottom:4px">✓ Tailored version saved</div>
          <div style="font-size:10px;color:#166534;margin-bottom:6px">${esc(this.approvedTailoredVersion)}</div>
          <a href="${esc(downloadUrl)}" target="_blank" rel="noopener noreferrer"
             style="display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:700;color:#c94010;text-decoration:none">
            ⬇ Download tailored PDF → attach to form
          </a>
        </div>
        <button class="btn ghost" data-action="open-tailor-editor" style="width:100%">Open full editor</button>
      `
    }

    return `
      <button class="btn primary" data-action="approve-tailor" ${!preview || preview.status !== "ready" || this.isBusy("tailor-approve") ? "disabled" : ""}>
        ${this.isBusy("tailor-approve") ? "Saving…" : "Save tailored version"}
      </button>
      <div style="font-size:10px;color:#64748b;text-align:center;margin-top:6px">
        Saves a tailored copy — your original resume is not changed
      </div>
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

  // ── Action eligibility helpers ───────────────────────────────────────────────

  /** Resolved Hireoven job ID for the active card, or null if not yet imported. */
  private jobResolvedId(): string | null {
    const cid = this.activeCanonicalId()
    if (!cid) return null
    return this.memoryByCanonical.get(cid)?.savedJobId ?? null
  }

  /** Absolute apply URL from the active job, or null if missing/invalid. */
  private activeApplyUrl(): string | null {
    const url = this.activeJob?.applyUrl ?? this.activeJob?.url
    return url?.startsWith("http") ? url : null
  }

  /** True when the job description has meaningful content. */
  private hasJobDescription(): boolean {
    const desc = this.activeJob?.description ?? ""
    return desc.trim().length > 20
  }

  /**
   * True when the active job has an explicit "no sponsorship" signal that
   * makes it ineligible for the apply queue — keyword-matched OR from the
   * scout overlay insights.
   */
  private hasNoSponsorHardBlock(): boolean {
    const card = this.activeCard()
    const cid = this.activeCanonicalId()
    const mem = cid ? this.memoryByCanonical.get(cid) : null
    if (mem?.insights?.sponsorshipLikely === false) return true
    if (card && sponsorshipHintFromText(card) === false) return true
    const sigText = `${card?.sponsorshipSignal ?? ""} ${this.activeJob?.sponsorshipSignal ?? ""}`.toLowerCase()
    return /no sponsorship|does not sponsor|without sponsorship|cannot sponsor|unable to sponsor/i.test(sigText)
  }

  /** Eligibility for the Tailor Resume button. */
  private tailorEligible(): { show: boolean; enabled: boolean; reason?: string } {
    if (!this.authenticated) return { show: false, enabled: false }
    const saved = Boolean(this.jobResolvedId())
    const hasDesc = this.hasJobDescription()
    // No description — hide entirely, user can't do anything
    if (!hasDesc) return { show: false, enabled: false }
    // Job not yet saved — show disabled with actionable reason
    if (!saved) return { show: true, enabled: false, reason: "Save job first" }
    // Resume list loaded and empty — show disabled with actionable reason
    if (this.resumeListFetched && !this.resumeListLoading && this.resumeList.length === 0) {
      return { show: true, enabled: false, reason: "Upload resume first" }
    }
    // Resume loading or present → enable
    return { show: true, enabled: true }
  }

  /** Eligibility for the Cover Letter button. */
  private coverEligible(): { show: boolean; enabled: boolean; reason?: string } {
    if (!this.authenticated) return { show: false, enabled: false }
    const saved = Boolean(this.jobResolvedId())
    const hasDesc = this.hasJobDescription()
    if (!hasDesc) return { show: false, enabled: false }
    if (!saved) return { show: true, enabled: false, reason: "Save job first" }
    return { show: true, enabled: true }
  }

  /** Eligibility for the Queue Apply button (add-to-queue action). */
  private queueAddEligible(): { show: boolean; enabled: boolean; reason?: string } {
    if (!this.authenticated) return { show: false, enabled: false }
    if (!this.activeApplyUrl()) return { show: false, enabled: false }
    if (this.hasNoSponsorHardBlock()) return { show: false, enabled: false }
    const saved = Boolean(this.jobResolvedId())
    if (!saved) return { show: true, enabled: false, reason: "Save job first" }
    return { show: true, enabled: true }
  }

  /** Render a single action button respecting eligibility. Returns "" when hidden. */
  private renderEligibleAction(
    action: string,
    label: string,
    opts: { show: boolean; enabled: boolean; reason?: string },
    busy?: boolean,
    busyLabel?: string,
    extra = "",
  ): string {
    if (!opts.show) return ""
    const isBusy = Boolean(busy)
    const disabled = isBusy || !opts.enabled
    const title = opts.reason ? ` title="${esc(opts.reason)}"` : ""
    const disabledAttr = disabled ? " disabled" : ""
    const displayLabel = isBusy ? (busyLabel ?? label) : (opts.reason && !opts.enabled ? `${label}` : label)
    return `<button class="action"${disabledAttr}${title} data-action="${action}"${extra}>${esc(displayLabel)}</button>`
  }

  private pendingQueueCount(): number {
    return this.queueState?.jobs.filter(
      (j) => !["submitted_manually", "skipped", "failed"].includes(j.status),
    ).length ?? 0
  }

  private renderQueuePillOrAdd(): string {
    const pending = this.pendingQueueCount()
    if (pending > 0) {
      return `<button class="action" data-action="open-queue" style="border-color:rgba(255,92,24,0.5);color:#c94010">Queue <span class="pill queue">${pending}</span></button>`
    }
    const el = this.queueAddEligible()
    return this.renderEligibleAction(
      "queue-add-active",
      this.isBusy("queue-add") ? "Adding…" : "+ Queue",
      el,
      this.isBusy("queue-add"),
    )
  }

  private renderBarActions(): string {
    if (!this.authenticated) {
      return `<button class="action primary" data-action="signin">Sign in to Hireoven</button>`
    }

    // ── Application form ───────────────────────────────────────────────────────
    if (this.mode === "application_form") {
      const canonicalId = this.activeCanonicalId()
      const memory      = canonicalId ? this.memoryByCanonical.get(canonicalId) : undefined
      const isChecking  = memory?.resolving ?? false
      const isSaving    = memory?.saving    ?? false
      const isSaved     = Boolean(memory?.savedJobId)
      const busy        = this.isBusy("autofill-load") || this.isBusy("autofill-fill")

      // Silently checking DB
      if (isChecking && !isSaved) {
        return `
          <button class="autofill-btn" disabled
            style="background:rgba(255,255,255,0.06);color:#64748b;">
            ⟳ Checking…
          </button>
        `
      }

      // Post-fill confirmation
      if (this.autofillFilledCount != null) {
        return `
          <button class="autofill-btn" data-action="autofill"
            style="background:rgba(255,92,24,0.12);color:#FF5C18;border:1px solid rgba(255,92,24,0.3);">
            ✓ ${this.autofillFilledCount} fields filled — Fill again
          </button>
          ${!isSaved ? `<button class="action" data-action="save" style="flex-shrink:0;">Save</button>` : ""}
        `
      }

      if (isSaving) {
        return `
          <button class="autofill-btn" disabled
            style="background:rgba(255,255,255,0.06);color:#64748b;">
            ⟳ Saving…
          </button>
        `
      }

      // Job not in Hireoven — Autofill still works, Save is optional
      if (!isSaved) {
        return `
          <button class="autofill-btn" data-action="autofill" ${busy ? "disabled" : ""}>
            ${busy ? "⟳ Preparing…" : "⚡ Autofill"}
          </button>
          <button class="action" data-action="save" style="flex-shrink:0;">Save</button>
        `
      }

      // Job is in Hireoven — full autofill button
      return `
        <button class="autofill-btn" data-action="autofill" ${busy ? "disabled" : ""}>
          ${busy ? "⟳ Preparing…" : "⚡ Autofill this Application"}
        </button>
      `
    }

    // ── Job detail ─────────────────────────────────────────────────────────────
    if (this.mode === "job_detail") {
      const canonicalId = this.activeCanonicalId()
      const memory      = canonicalId ? this.memoryByCanonical.get(canonicalId) : undefined
      const isChecking  = memory?.resolving ?? false
      const isSaving    = memory?.saving    ?? false
      const isSaved     = Boolean(memory?.savedJobId)

      const applyUrl = this.activeApplyUrl()
      const nextPos  = this.queuePosition()
      const nextBtn  = nextPos?.nextKey
        ? `<button class="action" data-action="queue-next">Next →</button>`
        : ""

      // Still checking DB
      if (isChecking && !isSaved) {
        return `<span style="font-size:12px;color:#64748b;padding:0 6px;">⟳ Checking…</span>`
      }

      // Saving in progress (user clicked Save)
      if (isSaving) {
        return `<span style="font-size:12px;color:#64748b;padding:0 6px;">⟳ Saving…</span>`
      }

      // Job is in Hireoven — show actions
      if (isSaved) {
        const openAppBtn = applyUrl
          ? `<button class="action primary" data-action="open-apply-url">Apply →</button>`
          : ""
        const tailorEl = this.renderEligibleAction("tailor", "Tailor", this.tailorEligible(), this.isBusy("tailor-load"), "Loading…")
        const coverEl  = this.renderEligibleAction("cover", "Cover", this.coverEligible(), this.isBusy("cover-generate"), "Generating…")
        const queueEl  = this.renderQueuePillOrAdd()
        return `
          <span style="font-size:11px;color:#FF5C18;padding:0 4px;font-weight:600;">✓ In Hireoven</span>
          ${openAppBtn}
          ${tailorEl}
          ${coverEl}
          ${queueEl}
          ${nextBtn}
        `
      }

      // Job not in Hireoven — autofill still available, save is optional
      const openAppBtn = applyUrl
        ? `<button class="action primary" data-action="open-apply-url">Apply →</button>`
        : ""
      return `
        ${openAppBtn}
        <button class="action" data-action="save">Save</button>
        ${nextBtn}
      `
    }

    // ── Search / list pages — signal pills + filters only ────────────────────
    // No Tailor, Cover, Autofill, or Queue Apply on list pages.
    if (this.mode === "search_results") {
      const h1bOn = this.screenerFilters.h1bOnly
      const activeFilterCount = [
        this.screenerFilters.h1bOnly,
        this.screenerFilters.eVerifyOnly,
        this.screenerFilters.hideNoSponsor,
        this.screenerFilters.hideViewed,
      ].filter(Boolean).length
      const pending = this.pendingQueueCount()
      const queuePill = pending > 0
        ? `<button class="action" data-action="open-queue" style="border-color:rgba(255,92,24,0.5);color:#c94010">Queue <span class="pill queue">${pending}</span></button>`
        : ""
      return `
        <button class="action${h1bOn ? " primary" : ""}" data-action="toggle-h1b-filter" title="Show only H-1B sponsoring jobs">
          ${h1bOn ? "✓ H-1B" : "H-1B filter"}
        </button>
        ${activeFilterCount > 1 ? `<span class="pill queue">${activeFilterCount} filters</span>` : ""}
        ${queuePill}
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
          <span class="brand" title="Hireoven">${BRAND_ICON_SVG}</span>
          ${this.mode !== "application_form"
            ? `<span class="title">${this.barTitleHtml()}</span>`
            : ""
          }
          ${this.renderBarActions()}
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
