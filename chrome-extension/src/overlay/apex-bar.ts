/**
 * Hireoven Apex Bar — MVP UI shell.
 *
 * Visual-only floating bar gated by isProbablyJobPage(). Pure UI + detection;
 * no backend calls, no autofill, no resume tailoring.
 *
 * Design contract:
 *   - Mount once per top frame, idempotent across SPA navigations.
 *   - Visible only when isProbablyJobPage() returns true.
 *   - Re-runs detection when the URL changes without a full reload.
 *   - Buttons (Save / Analyze / Tailor / Autofill) are inert in MVP.
 */

import { detectSite, type SupportedSite } from "../detectors/site"
import { isProbablyJobPage } from "../detectors/site"
import { isWorkdayAuthPage } from "../detectors/ats"
import {
  detectApplicationForm,
  type ApplicationFormDetection,
} from "../detectors/application-form"
import {
  detectConfirmation,
  type ConfirmationDetection,
} from "../detectors/confirmation"
import {
  detectExtensionPageMode,
  isAtsSite,
  shouldShowAutofillFeatures,
  type ExtensionPageMode,
} from "../detectors/page-mode"
import { extractJob, type ExtractedJob } from "../extractors/apex-extractor"
import {
  analyzeExtractedJob,
  answerQuestion,
  checkExtractedJob,
  fetchCoverLetterDocx,
  fetchPrimaryResume,
  generateCoverLetter,
  getAutofillProfile,
  matchQuestions,
  saveApplicationProof,
  saveExtractedJob,
  trackAutofillTelemetry,
  updateCoverLetter,
} from "../api-client"
import type { ExtensionJobAnalysis, ExtensionSaveResult } from "../api-types"
import type {
  InjectResumeFileInTabResult,
  TailorPreviewResult,
  TailorApproveResult,
} from "../types"
import {
  applySafeFills,
  buildAutofillPreview,
  injectDocxFile,
  setReactValue,
  type AutofillSource,
  type AutofillFieldResult,
  type SafeProfile,
} from "../autofill/safe-fields"
import { findUnfilledRequiredFields } from "../autofill/required-fields"
import {
  fillRequiredAtsFields,
  fillAshbyComboboxes,
  type RequiredFieldFillNote,
} from "../autofill/ashby-autofill"
import {
  estimateWorkdayAutofillFields,
  isWorkdayApplicationPage,
  runWorkdayAutofillInExistingBar,
  type WorkdayAutofillSnapshot,
  type WorkdayDebugEntry,
} from "../autofill/workday-autofill"

// ── Public types ──────────────────────────────────────────────────────────────

export type ApexBarState = "detecting" | "not_job_page" | "ready" | "error"

// ── Constants ─────────────────────────────────────────────────────────────────

const HOST_ID = "hireoven-apex-bar"
const MINIMIZED_STORAGE_KEY = "hireovenApexBarMinimized"
const URL_POLL_INTERVAL_MS = 600
const ATS_FORM_REFRESH_INTERVAL_MS = 1200

const TAILORING_ATS_SITES = new Set([
  "greenhouse",
  "lever",
  "ashby",
  "workday",
  "icims",
  "smartrecruiters",
  "bamboohr",
])

const STATUS_TEXT: Record<ApexBarState, string> = {
  detecting:    "Detecting job page…",
  ready:        "Job page detected",
  not_job_page: "Not a supported job page",
  error:        "Extraction failed",
}

// ── Styles (inlined; no external resources) ───────────────────────────────────

const STYLES = `
  :host { all: initial; }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  .apex-bar {
    position: fixed;
    left: 50%;
    bottom: 20px;
    transform: translateX(-50%);
    z-index: 2147483647;
    display: inline-flex;
    align-items: center;
    gap: 14px;
    padding: 10px 12px 10px 16px;
    background: #0a0a0a;
    color: #fafafa;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 14px;
    box-shadow:
      0 1px 0 rgba(255, 255, 255, 0.04) inset,
      0 12px 36px rgba(0, 0, 0, 0.5),
      0 2px 8px rgba(0, 0, 0, 0.3);
    font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 13px;
    line-height: 1.4;
    max-width: min(720px, 92vw);
    user-select: none;
    -webkit-font-smoothing: antialiased;
  }

  .brand {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding-right: 12px;
    border-right: 1px solid rgba(255, 255, 255, 0.08);
  }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #22c55e;
    box-shadow: 0 0 8px rgba(34, 197, 94, 0.6);
  }
  .dot.detecting    { background: #facc15; box-shadow: 0 0 8px rgba(250, 204, 21, 0.55); }
  .dot.error        { background: #ef4444; box-shadow: 0 0 8px rgba(239, 68, 68, 0.55); }
  .dot.not_job_page { background: #71717a; box-shadow: none; }

  .brand-text {
    font-weight: 600;
    letter-spacing: -0.01em;
    color: #fafafa;
    white-space: nowrap;
  }

  .status {
    font-size: 12px;
    color: #a1a1aa;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 380px;
  }
  .status .site {
    color: #d4d4d8;
    text-transform: capitalize;
  }

  .actions {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding-left: 8px;
    border-left: 1px solid rgba(255, 255, 255, 0.08);
  }

  .action {
    background: rgba(255, 255, 255, 0.04);
    color: #fafafa;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 8px;
    padding: 6px 10px;
    font-size: 12px;
    font-weight: 500;
    font-family: inherit;
    cursor: pointer;
    transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
  }
  .action:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.16);
  }
  .action:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .minimize {
    background: transparent;
    border: 0;
    color: #71717a;
    font-size: 18px;
    font-family: inherit;
    line-height: 1;
    cursor: pointer;
    padding: 4px 8px;
    border-radius: 6px;
    margin-left: 2px;
  }
  .minimize:hover {
    color: #fafafa;
    background: rgba(255, 255, 255, 0.06);
  }

  .restore {
    position: fixed;
    bottom: 20px;
    right: 20px;
    z-index: 2147483647;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: #0a0a0a;
    color: #22c55e;
    border: 1px solid rgba(255, 255, 255, 0.1);
    font-size: 18px;
    font-family: inherit;
    cursor: pointer;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: background 0.15s ease;
  }
  .restore:hover { background: #1a1a1a; }

  /* ── Debug toggle (dev installs only) ────────────────────────────────────── */
  .debug-toggle {
    background: transparent;
    border: 1px solid rgba(255, 255, 255, 0.08);
    color: #71717a;
    font-size: 11px;
    font-weight: 600;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    line-height: 1;
    width: 22px;
    height: 22px;
    border-radius: 6px;
    cursor: pointer;
    padding: 0;
    margin-left: 4px;
  }
  .debug-toggle:hover {
    color: #fafafa;
    border-color: rgba(255, 255, 255, 0.16);
    background: rgba(255, 255, 255, 0.06);
  }

  /* ── Debug panel (dev only, expandable) ──────────────────────────────────── */
  .debug-panel {
    position: fixed;
    left: 50%;
    bottom: 78px;
    transform: translateX(-50%);
    z-index: 2147483647;
    width: min(720px, 92vw);
    max-height: 360px;
    overflow: auto;
    padding: 12px 14px;
    background: #0a0a0a;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 12px;
    box-shadow: 0 12px 36px rgba(0, 0, 0, 0.5);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 11px;
    line-height: 1.5;
    color: #fafafa;
  }
  .debug-row {
    display: grid;
    grid-template-columns: 130px 1fr;
    gap: 12px;
    padding: 4px 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  }
  .debug-row:last-child { border-bottom: 0; }
  .debug-key {
    color: #71717a;
    font-weight: 600;
  }
  .debug-val {
    color: #fafafa;
    word-break: break-word;
    overflow-wrap: anywhere;
  }
  .debug-val em { color: #52525b; font-style: normal; }

  /* ── Action button states ────────────────────────────────────────────────── */
  .action.saved {
    background: rgba(34, 197, 94, 0.12);
    border-color: rgba(34, 197, 94, 0.3);
    color: #4ade80;
  }
  .action.saved:hover { background: rgba(34, 197, 94, 0.18); }
  .action.analyzed {
    background: rgba(59, 130, 246, 0.12);
    border-color: rgba(59, 130, 246, 0.3);
    color: #60a5fa;
  }
  .action.analyzed:hover { background: rgba(59, 130, 246, 0.18); }
  .action.error {
    background: rgba(239, 68, 68, 0.1);
    border-color: rgba(239, 68, 68, 0.3);
    color: #f87171;
  }
  .action.error:hover { background: rgba(239, 68, 68, 0.18); }

  /* ── Analysis result panel ───────────────────────────────────────────────── */
  /* Hireoven palette: pure black, white, and brand orange (#FF5C18). No gradients. */

  .analysis-panel {
    position: fixed;
    left: 50%;
    bottom: 78px;
    transform: translateX(-50%);
    z-index: 2147483647;
    width: min(580px, 92vw);
    max-height: min(560px, calc(100vh - 110px));
    overflow-y: auto;
    padding: 0;
    background: #0a0a0a;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 14px;
    box-shadow: 0 1px 0 rgba(255, 255, 255, 0.04) inset, 0 16px 44px rgba(0, 0, 0, 0.55);
    font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: 13px;
    color: #fafafa;
  }
  .analysis-panel::-webkit-scrollbar { width: 6px; }
  .analysis-panel::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 3px; }

  /* Header */
  .ap-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 16px 10px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }
  .ap-title {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #a1a1aa;
  }
  .ap-close {
    background: transparent;
    border: 0;
    color: #71717a;
    font-size: 18px;
    line-height: 1;
    cursor: pointer;
    padding: 2px 6px;
    border-radius: 4px;
    font-family: inherit;
  }
  .ap-close:hover { color: #fafafa; background: rgba(255,255,255,0.06); }

  /* Section */
  .ap-section {
    padding: 14px 16px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }
  .ap-section:last-child { border-bottom: 0; }
  .ap-section-title {
    margin: 0 0 10px;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: #71717a;
  }

  /* Overview rows */
  .ap-rows { display: grid; gap: 4px; }
  .ap-row {
    display: grid;
    grid-template-columns: 120px 1fr;
    gap: 12px;
    padding: 3px 0;
    font-size: 12.5px;
  }
  .ap-key { color: #a1a1aa; }
  .ap-val { color: #fafafa; }
  .ap-val.ap-val-strong { color: #FF5C18; font-weight: 600; }
  .ap-val.ap-val-pos    { color: #fafafa; }
  .ap-val.ap-val-muted  { color: #71717a; }

  /* Signal groups */
  .ap-group { margin-bottom: 10px; }
  .ap-group:last-child { margin-bottom: 0; }
  .ap-group-label {
    font-size: 11px;
    font-weight: 600;
    color: #d4d4d8;
    margin-bottom: 6px;
  }
  .ap-chips { display: flex; flex-direction: column; gap: 4px; }

  /* Individual signal (chip + drawer) */
  .ap-signal { display: flex; flex-direction: column; }
  .ap-chip {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 8px 10px;
    border-radius: 8px;
    font-size: 12px;
    font-weight: 500;
    font-family: inherit;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.08);
    color: #fafafa;
    cursor: pointer;
    text-align: left;
    transition: background 0.15s ease, border-color 0.15s ease;
  }
  .ap-chip:hover {
    background: rgba(255, 255, 255, 0.06);
    border-color: rgba(255, 255, 255, 0.16);
  }
  .ap-signal[data-expanded="true"] .ap-chip {
    border-color: rgba(255, 92, 24, 0.4);
    background: rgba(255, 92, 24, 0.06);
  }
  .ap-chip-label { flex: 1; }
  .ap-chip-conf {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    border-radius: 4px;
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    background: rgba(255, 255, 255, 0.06);
    color: #a1a1aa;
  }
  .ap-chip-conf-high   { background: rgba(255, 92, 24, 0.18); color: #FF5C18; }
  .ap-chip-conf-medium { background: rgba(255, 255, 255, 0.08); color: #d4d4d8; }
  .ap-chip-conf-low    { background: rgba(255, 255, 255, 0.04); color: #71717a; }
  .ap-chip-caret {
    color: #71717a;
    font-size: 10px;
    line-height: 1;
  }

  /* Evidence drawer */
  .ap-evidence {
    margin: 4px 0 8px;
    padding: 10px 12px;
    background: rgba(255, 255, 255, 0.02);
    border: 1px solid rgba(255, 92, 24, 0.18);
    border-radius: 8px;
  }
  .ap-evidence-empty {
    color: #71717a;
    font-style: italic;
    font-size: 12px;
  }
  .ap-evidence-label {
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: #71717a;
    margin-bottom: 6px;
  }
  .ap-evidence-text {
    margin: 0;
    padding: 0;
    border-left: 2px solid #FF5C18;
    padding-left: 10px;
    color: #d4d4d8;
    font-size: 12px;
    line-height: 1.55;
    white-space: pre-wrap;
    word-break: break-word;
    overflow-wrap: anywhere;
  }

  .ap-empty {
    color: #71717a;
    font-size: 12px;
    font-style: italic;
  }

  /* Actions row */
  .ap-section-actions { padding-bottom: 14px; }
  .ap-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .ap-action {
    background: rgba(255, 255, 255, 0.04);
    color: #fafafa;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 8px;
    padding: 7px 12px;
    font-size: 12px;
    font-weight: 500;
    font-family: inherit;
    cursor: pointer;
    transition: background 0.15s ease, border-color 0.15s ease;
  }
  .ap-action:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.16);
  }
  .ap-action:disabled { opacity: 0.4; cursor: not-allowed; }
  .ap-action-primary {
    background: #FF5C18;
    color: #0a0a0a;
    border-color: #FF5C18;
    font-weight: 600;
  }
  .ap-action-primary:hover:not(:disabled) {
    background: #ff7032;
    border-color: #ff7032;
  }
  .ap-action-saved {
    background: transparent;
    color: #FF5C18;
    border-color: rgba(255, 92, 24, 0.4);
  }
  .ap-action-saved:hover { background: rgba(255, 92, 24, 0.06); }
  .ap-action-link {
    background: transparent;
    color: #fafafa;
    border-color: transparent;
    text-decoration: underline;
    text-decoration-color: rgba(255, 255, 255, 0.2);
    text-underline-offset: 3px;
    margin-left: auto;
  }
  .ap-action-link:hover {
    color: #FF5C18;
    background: transparent;
    text-decoration-color: #FF5C18;
  }

  /* ── Autofill panel — right-side light sidebar ─────────────────────────── */
  @keyframes ho-af-slide-in {
    from { transform: translateX(16px); opacity: 0; }
    to   { transform: translateX(0);    opacity: 1; }
  }
  .autofill-panel {
    position: fixed;
    right: 0;
    top: 0;
    bottom: 0;
    z-index: 2147483647;
    width: min(420px, 92vw);
    display: flex;
    flex-direction: column;
    background: #ffffff;
    border-left: 1px solid rgba(15, 23, 42, 0.08);
    box-shadow: -8px 0 32px rgba(15, 23, 42, 0.10);
    font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: 13px;
    color: #0a0a0a;
    animation: ho-af-slide-in 180ms ease-out;
  }
  .autofill-panel::-webkit-scrollbar { width: 6px; }
  .autofill-panel::-webkit-scrollbar-thumb { background: rgba(15,23,42,0.12); border-radius: 3px; }

  /* Light-theme overrides for shared ap-* primitives */
  .autofill-panel .ap-header {
    padding: 14px 18px 12px;
    border-bottom: 1px solid rgba(15, 23, 42, 0.08);
    background: #ffffff;
  }
  .autofill-panel .ap-title { color: #52525b; }
  .autofill-panel .ap-close { color: #71717a; }
  .autofill-panel .ap-close:hover { color: #0a0a0a; background: rgba(15, 23, 42, 0.05); }

  .autofill-panel .ap-action {
    background: #ffffff;
    color: #0a0a0a;
    border: 1px solid rgba(15, 23, 42, 0.12);
  }
  .autofill-panel .ap-action:hover:not(:disabled) {
    background: rgba(15, 23, 42, 0.04);
    border-color: rgba(15, 23, 42, 0.20);
  }
  .autofill-panel .ap-action-primary {
    background: #FF5C18;
    color: #ffffff;
    border-color: #FF5C18;
  }
  .autofill-panel .ap-action-primary:hover:not(:disabled) {
    background: #ff7032;
    border-color: #ff7032;
  }

  .af-summary {
    padding: 12px 18px;
    border-bottom: 1px solid rgba(15, 23, 42, 0.06);
    display: flex;
    flex-direction: column;
    gap: 4px;
    background: #fafafa;
  }
  .af-summary-text {
    font-size: 12px;
    color: #52525b;
  }
  .af-warn {
    font-size: 11px;
    color: #b45309;
  }
  .af-list {
    flex: 1;
    overflow-y: auto;
    padding: 8px 10px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .af-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 12px;
    border-radius: 8px;
    border: 1px solid transparent;
  }
  .af-row-main {
    flex: 1;
    min-width: 0;
  }
  .af-row-label {
    font-size: 12px;
    font-weight: 600;
    color: #0a0a0a;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .af-row-value {
    font-size: 11px;
    color: #52525b;
    margin-top: 2px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .af-row-value em { color: #a1a1aa; font-style: italic; }
  .af-row-status {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    padding: 4px 8px;
    border-radius: 4px;
    flex-shrink: 0;
  }
  .af-row-filled  { background: rgba(255, 92, 24, 0.06); border-color: rgba(255, 92, 24, 0.18); }
  .af-row-filled  .af-row-status  { background: rgba(255, 92, 24, 0.14); color: #c2410c; }
  .af-row-skipped { background: rgba(15, 23, 42, 0.02); }
  .af-row-skipped .af-row-status  { background: rgba(15, 23, 42, 0.06); color: #52525b; }
  .af-row-pending .af-row-status  { background: rgba(255, 92, 24, 0.10); color: #c2410c; }

  .af-ai-btn {
    margin-top: 6px;
    padding: 3px 10px;
    font-size: 11px;
    font-weight: 600;
    border-radius: 5px;
    border: 1px solid rgba(3, 105, 161, 0.35);
    background: rgba(3, 105, 161, 0.07);
    color: #0369A1;
    cursor: pointer;
    transition: background 0.15s;
    white-space: nowrap;
  }
  .af-ai-btn:hover:not(:disabled) { background: rgba(3, 105, 161, 0.14); }
  .af-ai-btn:disabled { opacity: 0.55; cursor: default; }
  .af-ai-btn.af-ai-fill {
    background: rgba(3, 105, 161, 0.14);
    border-color: rgba(3, 105, 161, 0.5);
  }
  .af-ai-answer-text {
    margin-top: 5px;
    font-size: 11px;
    color: #374151;
    line-height: 1.5;
    background: rgba(3, 105, 161, 0.05);
    border-radius: 4px;
    padding: 5px 7px;
    white-space: pre-wrap;
  }
  .af-ai-error { margin-top: 4px; font-size: 11px; color: #b91c1c; }

  .af-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 12px 18px 16px;
    border-top: 1px solid rgba(15, 23, 42, 0.08);
    background: #ffffff;
  }
  .af-progress {
    padding: 12px 18px;
    color: #52525b;
    font-size: 12px;
    font-style: italic;
    border-top: 1px solid rgba(15, 23, 42, 0.06);
  }

  /* ── Proof prompt (above the bar) ─────────────────────────────────────── */
  @keyframes ho-proof-rise {
    from { transform: translate(-50%, 12px); opacity: 0; }
    to   { transform: translate(-50%, 0);    opacity: 1; }
  }
  .proof-prompt {
    position: fixed;
    left: 50%;
    bottom: 80px;
    transform: translateX(-50%);
    z-index: 2147483646;
    width: min(520px, 92vw);
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 14px;
    background: #ffffff;
    color: #0a0a0a;
    border: 1px solid rgba(15, 23, 42, 0.10);
    border-radius: 12px;
    box-shadow: 0 12px 32px rgba(15, 23, 42, 0.18);
    font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: 13px;
    animation: ho-proof-rise 200ms ease-out;
  }
  .proof-prompt-saved { background: #fff8f5; border-color: rgba(255, 92, 24, 0.30); }
  .proof-prompt-error { border-color: rgba(220, 38, 38, 0.30); }

  .proof-prompt-body {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }
  .proof-icon {
    flex-shrink: 0;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: #FF5C18;
    color: #ffffff;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-weight: 700;
    font-size: 14px;
  }
  .proof-title {
    font-weight: 600;
    color: #0a0a0a;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .proof-sub {
    font-size: 11px;
    color: #52525b;
    margin-top: 2px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .proof-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }
  .proof-btn {
    border: 1px solid rgba(15, 23, 42, 0.12);
    background: #ffffff;
    color: #0a0a0a;
    border-radius: 8px;
    padding: 7px 12px;
    font-size: 12px;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
  }
  .proof-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .proof-btn-primary {
    background: #FF5C18;
    color: #ffffff;
    border-color: #FF5C18;
  }
  .proof-btn-primary:hover:not(:disabled) {
    background: #ff7032;
    border-color: #ff7032;
  }
  .proof-dismiss {
    background: transparent;
    border: 0;
    color: #71717a;
    font-size: 18px;
    line-height: 1;
    cursor: pointer;
    padding: 4px 8px;
    border-radius: 4px;
    font-family: inherit;
  }
  .proof-dismiss:hover { color: #0a0a0a; background: rgba(15, 23, 42, 0.05); }

  /* ── Autofill detection pill (in the bar) ──────────────────────────────── */
  .af-pill {
    display: inline-flex;
    align-items: center;
    height: 24px;
    padding: 0 8px;
    border-radius: 12px;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    border: 1px solid transparent;
    white-space: nowrap;
    user-select: none;
  }
  .af-pill-supported { background: rgba(255, 92, 24, 0.16); color: #FF5C18; border-color: rgba(255, 92, 24, 0.30); }
  .af-pill-partial   { background: rgba(250, 204, 21, 0.14); color: #facc15; border-color: rgba(250, 204, 21, 0.28); }
  .af-pill-none      { background: rgba(255, 255, 255, 0.05); color: #a1a1aa; border-color: rgba(255, 255, 255, 0.10); }

  /* ── Detection panel rows (light theme, reuses .autofill-panel chrome) ─── */
  .dt-support { display: flex; align-items: center; }
  .dt-row {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 10px 12px;
    border-radius: 8px;
    border: 1px solid transparent;
    background: rgba(15, 23, 42, 0.02);
  }
  .dt-row + .dt-row { margin-top: 4px; }
  .dt-row-main { flex: 1; min-width: 0; }
  .dt-row-label {
    font-size: 12px;
    font-weight: 600;
    color: #0a0a0a;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dt-row-meta {
    margin-top: 3px;
    display: flex;
    gap: 8px;
    font-size: 11px;
    color: #52525b;
  }
  .dt-type { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .dt-name { font-style: italic; opacity: 0.85; }
  .dt-row-tags {
    display: flex;
    gap: 4px;
    flex-shrink: 0;
    flex-wrap: wrap;
    justify-content: flex-end;
  }
  .dt-tag {
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    padding: 3px 6px;
    border-radius: 4px;
  }
  .dt-tag-required    { background: rgba(220, 38, 38, 0.10); color: #b91c1c; }
  .dt-tag-conf-high   { background: rgba(34, 197, 94, 0.10); color: #15803d; }
  .dt-tag-conf-medium { background: rgba(250, 204, 21, 0.14); color: #a16207; }
  .dt-tag-conf-low    { background: rgba(15, 23, 42, 0.06);  color: #52525b; }
  .dt-reasons {
    list-style: disc;
    padding: 4px 18px 12px 32px;
    margin: 0;
    color: #52525b;
    font-size: 11px;
    line-height: 1.5;
  }

  /* ── Cover letter review section ───────────────────────────────────────── */
  .cl-section {
    border-top: 1px solid rgba(15, 23, 42, 0.08);
    padding: 14px 18px 12px;
    background: #fafafa;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .cl-section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .cl-section-title {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #52525b;
  }
  .cl-pill {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    padding: 4px 8px;
    border-radius: 4px;
  }
  .cl-pill-progress { background: rgba(15, 23, 42, 0.06);  color: #52525b; }
  .cl-pill-ready    { background: rgba(255, 92, 24, 0.12); color: #c2410c; }
  .cl-pill-attached { background: rgba(255, 92, 24, 0.16); color: #c2410c; }
  .cl-pill-error    { background: rgba(220, 38, 38, 0.10); color: #b91c1c; }

  .cl-textarea {
    width: 100%;
    min-height: 200px;
    max-height: 320px;
    resize: vertical;
    background: #ffffff;
    color: #0a0a0a;
    border: 1px solid rgba(15, 23, 42, 0.12);
    border-radius: 8px;
    padding: 10px 12px;
    font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: 12px;
    line-height: 1.55;
    outline: none;
  }
  .cl-textarea:focus {
    border-color: rgba(255, 92, 24, 0.5);
    box-shadow: 0 0 0 3px rgba(255, 92, 24, 0.10);
  }
  .cl-error-empty {
    font-size: 12px;
    color: #b91c1c;
    padding: 8px 10px;
    background: rgba(220, 38, 38, 0.06);
    border: 1px solid rgba(220, 38, 38, 0.18);
    border-radius: 8px;
  }
  .cl-actions {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
    flex-wrap: wrap;
  }

  /* Skeleton shimmer for the generation phase */
  @keyframes ho-cl-shimmer {
    0%   { opacity: 0.55; }
    100% { opacity: 0.95; }
  }
  .cl-skeleton {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .cl-skeleton > div {
    height: 10px;
    border-radius: 4px;
    background: linear-gradient(90deg, rgba(15,23,42,0.06), rgba(15,23,42,0.10), rgba(15,23,42,0.06));
    animation: ho-cl-shimmer 1.1s ease-in-out infinite alternate;
  }
  .cl-skeleton > div:nth-child(1) { width: 92%; }
  .cl-skeleton > div:nth-child(2) { width: 78%; }
  .cl-skeleton > div:nth-child(3) { width: 64%; }

  /* Draggable handle — brand + status area */
  .brand, .status { cursor: grab; user-select: none; }
  .brand:active, .status:active { cursor: grabbing; }

  /* Agent login-waiting banner */
  .agent-login-banner {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 12px 14px;
    background: linear-gradient(135deg, #fff8f0 0%, #fff3e8 100%);
    border: 1px solid rgba(249, 115, 22, 0.3);
    border-radius: 10px;
    margin-bottom: 6px;
  }
  .agent-login-icon { font-size: 16px; line-height: 1; flex-shrink: 0; }
  .agent-login-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .agent-login-text strong {
    font-size: 12px;
    font-weight: 700;
    color: #9a3412;
    line-height: 1.3;
  }
  .agent-login-text span {
    font-size: 11px;
    color: #c2410c;
    line-height: 1.4;
  }
  .agent-review-banner {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 12px 14px;
    background: linear-gradient(135deg, #f0fdf4 0%, #ecfdf5 100%);
    border: 1px solid rgba(16, 185, 129, 0.3);
    border-radius: 10px;
    margin-bottom: 6px;
  }
  .agent-review-icon { font-size: 16px; line-height: 1; flex-shrink: 0; }
  .agent-review-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .agent-review-text strong {
    font-size: 12px;
    font-weight: 700;
    color: #166534;
    line-height: 1.3;
  }
  .agent-review-text span {
    font-size: 11px;
    color: #15803d;
    line-height: 1.4;
  }
`

// ── Utility ───────────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;"
  )
}

/**
 * Pulls the most useful actionable hint out of the Workday runner's debug
 * tail. Surfaces it in the bar's error toast so users don't have to open
 * DevTools to learn why a run stopped. Returns null when there's nothing
 * recognizable to summarize.
 */
function summarizeWorkdayDebug(tail: WorkdayDebugEntry[] | undefined): string | null {
  if (!tail || tail.length === 0) return null

  // Map specific debug events to human messages. Ordered by usefulness — the
  // first match wins, so the user always sees the actionable cause.
  const eventHints: Array<[string, (e: WorkdayDebugEntry) => string]> = [
    ["context.initialize.profile_missing", () =>
      "your Hireoven autofill profile is empty — open Hireoven and complete your profile first"],
    ["context.initialize.resume_not_found", () =>
      "no resume on file — upload one in Hireoven before retrying"],
    ["run.pause_account_required", () =>
      "Workday requires Sign In or Create Account first"],
    ["run.pause_self_identify", () =>
      "Self-Identify step reached — complete it manually, then click Retry"],
    ["run.advance_blocked_required_missing", (e) =>
      `${String(e.details?.misses ?? "Some")} required field(s) couldn't auto-fill — complete them manually before continuing`],
    ["resume_upload.error_dom_marker", () =>
      "Workday rejected the resume upload — try uploading manually"],
    ["resume_upload.progress_timeout", () =>
      "resume upload did not confirm within 15s — verify on the page and retry"],
    ["combobox.target_missing", (e) =>
      `couldn't find the ${String(e.details?.fieldName ?? "dropdown")} dropdown on this Workday tenant`],
    ["navigation.next.fallback_missing", () =>
      "no Next/Save button was visible after filling — Workday may be blocking advance on a required field"],
  ]

  // Most recent error/warn first.
  for (let i = tail.length - 1; i >= 0; i -= 1) {
    const entry = tail[i]
    if (entry.level !== "warn" && entry.level !== "error") continue
    for (const [eventName, build] of eventHints) {
      if (entry.event === eventName) return build(entry)
    }
  }

  // No specific match — surface the last warn/error event name as a clue.
  for (let i = tail.length - 1; i >= 0; i -= 1) {
    const entry = tail[i]
    if (entry.level === "warn" || entry.level === "error") {
      return `last issue: ${entry.event}${entry.stepName ? ` on ${entry.stepName}` : ""}`
    }
  }
  return null
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isActionableButton(el: Element | null): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false
  if (el.hidden) return false
  const style = window.getComputedStyle(el)
  if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false
  if (el.getAttribute("aria-disabled") === "true") return false
  if ("disabled" in el && (el as HTMLButtonElement | HTMLInputElement).disabled) return false
  const rect = el.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}

function pageSignature(): string {
  const body = document.body
  const text = body ? body.innerText.replace(/\s+/g, " ").slice(0, 420) : ""
  const fields = document.querySelectorAll("input, select, textarea, button").length
  return `${location.href}|${fields}|${text}`
}

/**
 * Send a popup-style message (raw response, not the {ok, data} EXT_MVP_*
 * envelope) to the background. Used for tailor preview/approve from inline
 * apex-bar flows so we don't need to add EXT_MVP_ wrappers for every action.
 */
function sendBackgroundMessage<T>(message: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    if (!chrome.runtime?.id) {
      reject(new Error("Extension context invalidated"))
      return
    }
    chrome.runtime.sendMessage(message, (response: T | undefined) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message))
        return
      }
      if (response === undefined) {
        reject(new Error("No response from background"))
        return
      }
      resolve(response)
    })
  })
}

// ── Implementation ────────────────────────────────────────────────────────────

/**
 * Outcome of one agent autofill loop. `needsLogin` distinguishes a mid-flow
 * sign-in requirement (pause + wait, keep retrying) from a genuine failure
 * (give up / advance the run). `reachedReview` means the agent filled every
 * step and is parked on the final review page — it deliberately did NOT click
 * submit; the user gives a 1-click confirm instead.
 */
interface AgentLoopResult {
  submitted: boolean
  reason?: string
  needsLogin?: boolean
  reachedReview?: boolean
}

export class ApexBar {
  private host: HTMLDivElement | null = null
  private shadow: ShadowRoot | null = null
  private root: HTMLDivElement | null = null
  private state: ApexBarState = "detecting"
  private site: SupportedSite = "unknown"
  private job: ExtractedJob | null = null
  private debugOpen = false
  private minimized = false
  private mounted = false
  private urlTimer: ReturnType<typeof setInterval> | null = null
  private atsFormRefreshTimer: ReturnType<typeof setInterval> | null = null
  private atsFormMutationObserver: MutationObserver | null = null
  private atsFormMutationDebounce: ReturnType<typeof setTimeout> | null = null
  private lastUrl = ""

  // ── Action state (Save / Analyze) ──────────────────────────────────────────
  private saveStatus: "idle" | "loading" | "saved" | "error" = "idle"
  private saveResult: ExtensionSaveResult | null = null
  private saveError: string | null = null

  private analyzeStatus: "idle" | "loading" | "done" | "error" = "idle"
  private analysis: ExtensionJobAnalysis | null = null
  private analyzeError: string | null = null
  private analysisOpen = false

  // Existence check — populated asynchronously on every job-page URL change.
  // When alreadySaved=true, the Save button is hidden entirely.
  private alreadySaved = false
  private existingDashboardUrl: string | null = null
  // Authoritative jobId from /check (when the job exists in the DB) or /save.
  // Used to look up the per-job tailored resume in the autofill flow.
  // Stored directly so we don't have to re-parse it from dashboardUrl strings.
  private knownJobId: string | null = null

  // Index of the currently-expanded signal in the analysis panel's evidence
  // drawer. Only one open at a time. null = all collapsed.
  private expandedSignalIndex: number | null = null

  // Tailor Resume runs inline on the autofill page — no redirect to the web
  // app. Click triggers GET_TAILOR_PREVIEW → APPROVE_TAILORED_RESUME in one
  // shot via the background, then surfaces success in the bar / panel.
  private tailorStatus: "idle" | "loading" | "done" | "error" = "idle"
  private tailorError: string | null = null
  private tailorMatchScore: number | null = null
  private tailoredResumeId: string | null = null
  private tailoredResumeVersionId: string | null = null
  private tailorSnapStatus: "idle" | "snapping" | "snapped" | "error" = "idle"
  private tailorSnapError: string | null = null

  // Autofill state across supported ATSes + generic form fallback.
  // States walk: idle → loading (fetch profile + preview) → preview (user
  // confirms) → filling → done | error.
  private autofillStatus:
    | "idle"
    | "loading"
    | "preview"
    | "filling"
    | "done"
    | "error" = "idle"
  private autofillPreview: AutofillFieldResult[] | null = null
  private autofillResults: AutofillFieldResult[] | null = null
  private autofillError: string | null = null
  private autofillProfile: SafeProfile | null = null
  private workdaySnapshot: WorkdayAutofillSnapshot | null = null

  // Cover-letter review flow. Triggered after profile fill completes when the
  // form has a cover_letter_upload slot. The user reviews and edits the
  // generated text, then clicks Attach to inject the DOCX into the file input.
  private coverLetterStatus:
    | "idle"
    | "generating"
    | "ready"
    | "saving"
    | "attaching"
    | "attached"
    | "error" = "idle"
  private coverLetterId: string | null = null
  private coverLetterBody: string | null = null
  private coverLetterDirty: boolean = false
  private coverLetterSelector: string | null = null
  private coverLetterError: string | null = null

  // Per-row AI answer state — keyed by field selector.
  private aiAnswers = new Map<string, { status: "loading" | "done" | "error"; answer?: string; error?: string }>()

  // Read-only application-form detection — runs on every detection cycle and
  // decides whether autofill is supported / partial / not-detected for the
  // status pill next to the Autofill button. Detection is purely informational:
  // never fills, clicks, or mutates the DOM.
  private formDetection: ApplicationFormDetection | null = null
  private detectionPanelOpen: boolean = false

  // Coarse mode for the page — drives whether the bar shows the
  // intelligence overlay (job-board sites) vs. the autofill primitives
  // (ATS application forms). Refreshed on every detection cycle.
  private pageMode: ExtensionPageMode = "unknown"

  // Application-confirmation capture flow. The bar passively detects success
  // pages and, on detection, fires POST /api/extension/applications/proof
  // automatically — no toast, no user click. The endpoint flips the matching
  // job_applications row to status='applied' so the pipeline tracker reflects
  // the submission silently. autoProofFired is a per-page guard so the polling
  // loop and the initial detection don't double-fire.
  private confirmation: ConfirmationDetection | null = null
  private proofStatus: "idle" | "saving" | "saved" | "error" = "idle"
  private autoProofFired: boolean = false
  private confirmationTimer: ReturnType<typeof setInterval> | null = null
  private agentModeRunning: boolean = false
  private agentWaitingForLogin: boolean = false
  // Stop-at-review handoff: the agent filled every step and is parked on the
  // final review page waiting for the user to click submit. The run stays alive
  // in `waiting_review`; the user's submit click navigates to the confirmation
  // page, which re-triggers the agent and advances the run.
  private agentWaitingForReview: boolean = false

  // Draggable position — null means centered (default)
  private barPosition: { left: number; bottom: number } | null = null
  private isDragging: boolean = false
  private dragStartMouse: { x: number; y: number } = { x: 0, y: 0 }
  private dragStartBar: { left: number; bottom: number } = { left: 0, bottom: 0 }
  private positionStyleEl: HTMLStyleElement | null = null

  private isDevInstall(): boolean {
    try {
      return !chrome.runtime.getManifest().update_url
    } catch {
      return false
    }
  }

  /** Mount the bar lifecycle. Idempotent. */
  async mount(): Promise<void> {
    if (this.mounted) return
    this.mounted = true

    // Hard guard against any pre-existing bar from a prior content-script
    // injection (SPA navigation, hot-reload, etc.).
    document.querySelectorAll(`#${HOST_ID}`).forEach((el) => el.remove())

    // Restore the user's minimized preference and dragged position.
    try {
      const stored = await chrome.storage.local.get([MINIMIZED_STORAGE_KEY, "apexBarPosition"])
      this.minimized = Boolean(stored[MINIMIZED_STORAGE_KEY])
      const pos = stored["apexBarPosition"]
      if (pos && typeof pos.left === "number" && typeof pos.bottom === "number") {
        this.barPosition = { left: pos.left, bottom: pos.bottom }
      }
    } catch {
      // chrome.storage may be unavailable in non-extension contexts — keep default.
    }

    if (!document.body) {
      await new Promise<void>((resolve) => {
        const onReady = () => {
          document.removeEventListener("DOMContentLoaded", onReady)
          resolve()
        }
        document.addEventListener("DOMContentLoaded", onReady)
      })
    }

    this.lastUrl = location.href
    this.runDetection()
    this.bindUrlObserver()
  }

  /** Tear down the bar and stop observers. */
  destroy(): void {
    if (this.urlTimer) clearInterval(this.urlTimer)
    this.urlTimer = null
    if (this.atsFormRefreshTimer) clearInterval(this.atsFormRefreshTimer)
    this.atsFormRefreshTimer = null
    this.atsFormMutationObserver?.disconnect()
    this.atsFormMutationObserver = null
    if (this.atsFormMutationDebounce) clearTimeout(this.atsFormMutationDebounce)
    this.atsFormMutationDebounce = null
    this.stopConfirmationPolling()
    this.tearDownSurface()
    this.mounted = false
  }

  // ── State machine ────────────────────────────────────────────────────────────

  private runDetection(): void {
    this.site = detectSite()
    this.job = null
    // Reset per-job action state on every navigation.
    this.saveStatus = "idle"
    this.saveResult = null
    this.saveError = null
    this.analyzeStatus = "idle"
    this.analysis = null
    this.analyzeError = null
    this.analysisOpen = false
    this.alreadySaved = false
    this.existingDashboardUrl = null
    this.knownJobId = null
    this.expandedSignalIndex = null
    this.tailorStatus = "idle"
    this.tailorError = null
    this.tailorMatchScore = null
    this.tailoredResumeId = null
    this.tailoredResumeVersionId = null
    this.tailorSnapStatus = "idle"
    this.tailorSnapError = null
    this.autofillStatus = "idle"
    this.autofillPreview = null
    this.autofillResults = null
    this.autofillError = null
    this.autofillProfile = null
    this.workdaySnapshot = null
    this.coverLetterStatus = "idle"
    this.coverLetterId = null
    this.coverLetterBody = null
    this.coverLetterDirty = false
    this.coverLetterSelector = null
    this.coverLetterError = null
    this.formDetection = null
    this.detectionPanelOpen = false
    this.pageMode = "unknown"
    this.confirmation = null
    this.proofStatus = "idle"
    this.autoProofFired = false

    let isJob: boolean
    try {
      isJob = isProbablyJobPage(location.href, document)
    } catch {
      this.state = "error"
      this.ensureSurface()
      this.render()
      return
    }

    // Confirmation pages may not match isProbablyJobPage (the URL/DOM tells a
    // different story). Always run confirmation detection first so we can keep
    // the bar visible to prompt for proof on real success screens.
    let confirmation: ConfirmationDetection | null = null
    try {
      confirmation = detectConfirmation(document)
    } catch {
      confirmation = null
    }
    this.confirmation = confirmation

    // Silently move the application to the "applied" column when we land on
    // a confirmation page. autoProofFired guards against double-firing if
    // the polling loop also flips the same confirmation later.
    if (confirmation?.isConfirmation && confirmation.confidence !== "low" && !this.autoProofFired) {
      this.autoProofFired = true
      void this.onSaveProof()
    }

    if (!isJob && !(confirmation?.isConfirmation && confirmation.confidence !== "low")) {
      this.state = "not_job_page"
      this.tearDownSurface()
      this.stopConfirmationPolling()
      return
    }

    // Page is a job page (or confirmation) — try to extract. Partial / failed
    // extraction must not break the bar; the UI degrades to "Job page detected".
    this.state = "ready"
    try {
      this.job = extractJob(document, location.href)
    } catch {
      this.job = null
    }

    // Read-only application-form detection. Pure read; never mutates the page.
    // Used to drive the "Autofill supported / partial / not detected" pill.
    try {
      this.formDetection = detectApplicationForm(document)
    } catch {
      this.formDetection = null
    }

    // Coarse page mode — gates which primitives the bar exposes.
    try {
      this.pageMode = detectExtensionPageMode(location.href, document)
    } catch {
      this.pageMode = "unknown"
    }

    this.ensureSurface()
    this.render()
    // Keep watching for late-arriving confirmation DOM (some ATSes inject
    // the success container after a brief async submit, with no URL change).
    this.startConfirmationPolling()

    // Fire-and-forget existence check. Re-renders when it resolves.
    if (this.job) {
      const targetUrl = location.href
      void checkExtractedJob({
        url: this.job.url,
        canonicalUrl: this.job.canonicalUrl,
        applyUrl: this.job.applyUrl,
      })
        .then((res) => {
          // Stale-response guard: discard if the user already navigated.
          if (location.href !== targetUrl) return
          this.alreadySaved = res.saved
          this.existingDashboardUrl = res.dashboardUrl ?? null
          // Authoritative jobId for downstream actions (autofill resume picker).
          // /check returns it whether or not the user has saved this job —
          // any time we found a matching jobs row, jobId is set.
          if (res.jobId) this.knownJobId = res.jobId
          this.render()
        })
        .catch(() => {
          // Swallow — bar continues to show Save button as a safe default.
        })
    }
  }

  /** Poll for SPA URL changes (LinkedIn, Workday, etc. swap routes without reload). */
  private bindUrlObserver(): void {
    this.urlTimer = setInterval(() => {
      const next = location.href
      if (next === this.lastUrl) return
      this.lastUrl = next
      this.runDetection()
    }, URL_POLL_INTERVAL_MS)
    this.bindAtsFormRefreshObserver()
  }

  /** Workday and other ATS UIs can change steps without changing URL. */
  private bindAtsFormRefreshObserver(): void {
    if (this.atsFormRefreshTimer) clearInterval(this.atsFormRefreshTimer)
    this.atsFormRefreshTimer = setInterval(() => this.refreshAtsFormDetection(), ATS_FORM_REFRESH_INTERVAL_MS)

    // Workday transitions can happen mid-interval. A debounced MutationObserver
    // catches those without dropping the 1.2s coarse poll (still useful when the
    // observer is throttled on extreme pages). Both paths converge on the same
    // detector so behaviour stays identical.
    this.atsFormMutationObserver?.disconnect()
    if (typeof MutationObserver === "undefined") return
    this.atsFormMutationObserver = new MutationObserver(() => {
      if (this.atsFormMutationDebounce) return
      this.atsFormMutationDebounce = setTimeout(() => {
        this.atsFormMutationDebounce = null
        this.refreshAtsFormDetection()
      }, 200)
    })
    this.atsFormMutationObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
    })
  }

  private refreshAtsFormDetection(): void {
    if (this.state !== "ready") return
    if (!isAtsSite(this.site)) return

    let nextFormDetection: ApplicationFormDetection | null = null
    try {
      nextFormDetection = detectApplicationForm(document)
    } catch {
      nextFormDetection = null
    }

    let nextPageMode: ExtensionPageMode = "unknown"
    try {
      nextPageMode = detectExtensionPageMode(location.href, document)
    } catch {
      nextPageMode = "unknown"
    }

    const prev = this.formDetection
    const formChanged =
      (prev?.hasForm ?? false) !== (nextFormDetection?.hasForm ?? false) ||
      (prev?.supportsAutofill ?? false) !== (nextFormDetection?.supportsAutofill ?? false) ||
      (prev?.formCount ?? 0) !== (nextFormDetection?.formCount ?? 0) ||
      (prev?.fields.length ?? 0) !== (nextFormDetection?.fields.length ?? 0) ||
      (prev?.detectedAts ?? "unknown") !== (nextFormDetection?.detectedAts ?? "unknown")

    const modeChanged = this.pageMode !== nextPageMode
    if (!formChanged && !modeChanged) return

    // Workday per-step UX: when the form shape changes substantially while
    // we're in a "done"/"error" autofill state, that's almost certainly the
    // user clicking Save and Continue and Workday loading the next step.
    // Re-arm the Autofill button so they can click it again for the new step.
    if (
      this.site === "workday" &&
      formChanged &&
      (this.autofillStatus === "done" || this.autofillStatus === "error")
    ) {
      this.autofillStatus = "idle"
      this.autofillPreview = null
      this.autofillResults = null
      this.autofillError = null
      this.workdaySnapshot = null
    }

    this.formDetection = nextFormDetection
    this.pageMode = nextPageMode
    this.render()
  }

  // ── Surface (Shadow DOM) ─────────────────────────────────────────────────────

  private ensureSurface(): void {
    if (this.host) return

    this.host = document.createElement("div")
    this.host.id = HOST_ID
    document.body.appendChild(this.host)

    this.shadow = this.host.attachShadow({ mode: "closed" })

    const styleEl = document.createElement("style")
    styleEl.textContent = STYLES
    this.shadow.appendChild(styleEl)

    this.root = document.createElement("div")
    this.shadow.appendChild(this.root)

    // Dynamic position override — injected after STYLES so it wins specificity
    this.positionStyleEl = document.createElement("style")
    this.shadow.appendChild(this.positionStyleEl)
    this.applyBarPosition()

    this.bindEvents()
    this.bindDragHandlers()
  }

  private tearDownSurface(): void {
    this.positionStyleEl = null
    this.host?.remove()
    this.host = null
    this.shadow = null
    this.root = null
  }

  private applyBarPosition(): void {
    if (!this.positionStyleEl) return
    if (this.barPosition) {
      const { left, bottom } = this.barPosition
      this.positionStyleEl.textContent =
        `.apex-bar { left: ${left}px !important; bottom: ${bottom}px !important; transform: none !important; }`
    } else {
      this.positionStyleEl.textContent = ""
    }
  }

  private bindDragHandlers(): void {
    if (!this.shadow) return

    this.shadow.addEventListener("mousedown", (e: Event) => {
      const me = e as MouseEvent
      const target = me.composedPath()[0] as HTMLElement | null
      if (!target?.closest(".brand") && !target?.closest(".status")) return
      me.preventDefault()

      const barEl = this.root?.querySelector<HTMLElement>(".apex-bar")
      if (!barEl) return
      const rect = barEl.getBoundingClientRect()

      this.isDragging = true
      this.dragStartMouse = { x: me.clientX, y: me.clientY }
      this.dragStartBar = {
        left: this.barPosition?.left ?? rect.left,
        bottom: this.barPosition?.bottom ?? (window.innerHeight - rect.bottom),
      }
    })

    document.addEventListener("mousemove", (e: MouseEvent) => {
      if (!this.isDragging) return
      e.preventDefault()

      const dx = e.clientX - this.dragStartMouse.x
      const dy = e.clientY - this.dragStartMouse.y
      const newLeft = Math.max(0, Math.min(window.innerWidth - 220, this.dragStartBar.left + dx))
      const newBottom = Math.max(0, Math.min(window.innerHeight - 56, this.dragStartBar.bottom - dy))

      this.barPosition = { left: newLeft, bottom: newBottom }
      this.applyBarPosition()
    })

    document.addEventListener("mouseup", () => {
      if (!this.isDragging) return
      this.isDragging = false
      if (this.barPosition) {
        chrome.storage.local.set({ apexBarPosition: this.barPosition }).catch(() => {})
      }
    })
  }

  private renderStatus(): string {
    if (this.state !== "ready") return escapeHtml(STATUS_TEXT[this.state])
    if (this.job?.title) {
      const company = this.job.company ? ` · ${escapeHtml(this.job.company)}` : ""
      return `${escapeHtml(this.job.title)}${company}`
    }
    // Job page detected but extraction yielded no title — keep generic copy.
    const siteSuffix = this.site !== "unknown" ? ` · ${escapeHtml(this.site)}` : ""
    return `${escapeHtml(STATUS_TEXT.ready)}${siteSuffix}`
  }

  private renderDebugPanel(): string {
    if (!this.debugOpen || !this.isDevInstall()) return ""
    const fields: Array<[string, string | undefined]> = this.job
      ? [
          ["source",         this.job.source],
          ["confidence",     this.job.confidence],
          ["title",          this.job.title],
          ["company",        this.job.company],
          ["location",       this.job.location],
          ["employmentType", this.job.employmentType],
          ["salaryText",     this.job.salaryText],
          ["applyUrl",       this.job.applyUrl],
          ["canonicalUrl",   this.job.canonicalUrl],
          ["url",            this.job.url],
          ["descriptionText",
            this.job.descriptionText
              ? `${this.job.descriptionText.slice(0, 200)}…`
              : undefined,
          ],
          ["extractedAt",    this.job.extractedAt],
          // Server-truth state — useful for diagnosing "Save button still
          // showing" or "autofill picked primary instead of tailored".
          ["alreadySaved (check)", String(this.alreadySaved)],
          ["dashboardUrl (check)", this.existingDashboardUrl ?? undefined],
          ["knownJobId",           this.knownJobId ?? undefined],
        ]
      : [["status", "no extraction yet"]]

    const rows = fields
      .map(([k, v]) =>
        `<div class="debug-row">
           <span class="debug-key">${escapeHtml(k)}</span>
           <span class="debug-val">${v ? escapeHtml(v) : "<em>—</em>"}</span>
         </div>`,
      )
      .join("")

    return `<div class="debug-panel">${rows}</div>`
  }

  private render(): void {
    if (!this.root) return

    if (this.minimized) {
      this.root.innerHTML = `
        <button class="restore" data-action="restore" aria-label="Show Hireoven Apex" title="Show Hireoven Apex">
          ●
        </button>
      `
      return
    }

    const debugBtn = this.isDevInstall()
      ? `<button class="debug-toggle" data-action="debug" title="${this.debugOpen ? "Hide debug" : "Show extracted fields"}" aria-label="Toggle debug">i</button>`
      : ""

    this.root.innerHTML = `
      ${this.renderDebugPanel()}
      ${this.renderDetectionPanel()}
      ${this.renderAutofillPanel()}
      ${this.renderAnalysisPanel()}
      ${this.renderProofPrompt()}
      ${this.agentWaitingForLogin ? `
        <div class="agent-login-banner" role="status" aria-live="polite">
          <span class="agent-login-icon">🔑</span>
          <div class="agent-login-text">
            <strong>Log in to continue</strong>
            <span>Apex will auto-fill your application once you're signed in.</span>
          </div>
        </div>` : ""}
      ${this.agentWaitingForReview ? `
        <div class="agent-review-banner" role="status" aria-live="polite">
          <span class="agent-review-icon">✅</span>
          <div class="agent-review-text">
            <strong>Ready to submit — review &amp; click submit</strong>
            <span>Apex filled every step. Check the form, then click the highlighted submit button. The next application opens automatically once this one is in.</span>
          </div>
        </div>` : ""}
      <div class="apex-bar" role="region" aria-label="Hireoven Apex">
        <div class="brand">
          <span class="dot ${this.state}"></span>
          <span class="brand-text">Hireoven Apex</span>
        </div>
        <div class="status">${this.renderStatus()}</div>
        <div class="actions">
          ${this.renderSaveButton()}
          ${this.renderAnalyzeButton()}
          ${this.renderTailorButton()}
          ${this.renderAutofillPill()}
          ${this.renderAutofillButton()}
        </div>
        ${debugBtn}
        <button class="minimize" data-action="minimize" aria-label="Minimize">−</button>
      </div>
    `
  }

  // ── Button rendering ────────────────────────────────────────────────────────

  private renderSaveButton(): string {
    // Already-in-tracker state takes precedence — hide the button entirely.
    // The user reaches the existing record via the dashboard or extension popup.
    if (this.alreadySaved && this.saveStatus !== "saved") {
      return ""
    }
    const enabled = this.state === "ready" && Boolean(this.job)
    if (this.saveStatus === "loading") {
      return `<button class="action" data-action="save" disabled>Saving…</button>`
    }
    if (this.saveStatus === "saved") {
      const dashAttr = this.saveResult?.dashboardUrl ? ` data-action="open-dashboard"` : ""
      return `<button class="action saved"${dashAttr} title="${escapeHtml(this.saveResult?.dashboardUrl ?? "")}">✓ Saved</button>`
    }
    if (this.saveStatus === "error") {
      return `<button class="action error" data-action="save" title="${escapeHtml(this.saveError ?? "Try again")}">Retry save</button>`
    }
    return `<button class="action" data-action="save"${enabled ? "" : " disabled"}>Save</button>`
  }

  private renderAnalyzeButton(): string {
    const enabled = this.state === "ready" && Boolean(this.job)
    if (this.analyzeStatus === "loading") {
      return `<button class="action" data-action="analyze" disabled>Analyzing…</button>`
    }
    if (this.analyzeStatus === "done") {
      const label = this.analysisOpen ? "Hide analysis" : "View analysis"
      return `<button class="action analyzed" data-action="toggle-analysis">${label}</button>`
    }
    if (this.analyzeStatus === "error") {
      return `<button class="action error" data-action="analyze" title="${escapeHtml(this.analyzeError ?? "Try again")}">Retry analyze</button>`
    }
    return `<button class="action" data-action="analyze"${enabled ? "" : " disabled"}>Analyze</button>`
  }

  private renderTailorButton(): string {
    const enabled = this.state === "ready" && Boolean(this.job)
    if (this.tailorStatus === "loading") {
      return `<button class="action" data-action="tailor" disabled>Tailoring…</button>`
    }
    if (this.tailorStatus === "done") {
      if (this.tailorSnapStatus === "snapping") {
        return `<button class="action analyzed" data-action="snap-resume" disabled>Snapping…</button>`
      }
      if (this.tailorSnapStatus === "snapped") {
        const tip = this.site === "workday"
          ? "Tailored resume saved. It will attach during Workday My Experience autofill."
          : this.tailorMatchScore !== null
            ? `Tailored resume saved · ${this.tailorMatchScore}% match`
            : "Tailored resume saved"
        return `<button class="action analyzed" data-action="snap-resume" disabled title="${escapeHtml(tip)}">✓ Tailored</button>`
      }
      const snapTip = this.tailorSnapError
        ? `Tailored resume saved. ${this.tailorSnapError}`
        : "Tailored resume saved. Click to snap it into this form."
      return `<button class="action error" data-action="snap-resume" title="${escapeHtml(snapTip)}">Snap Resume</button>`
    }
    if (this.tailorStatus === "error") {
      return `<button class="action error" data-action="tailor" title="${escapeHtml(this.tailorError ?? "Try again")}">Retry tailor</button>`
    }
    return `<button class="action" data-action="tailor"${enabled ? "" : " disabled"}>Tailor Resume</button>`
  }

  /**
   * Compact "Autofill supported / partial / not detected" pill rendered next
   * to the Autofill button. Drives off the read-only detection result —
   * never reflects fill state, only what's on the page.
   *
   * Hidden on job-board pages (LinkedIn / Indeed / Glassdoor / Handshake)
   * unless a real application form was detected — otherwise we'd be
   * promising autofill on a discovery surface where it can't actually run.
   */
  private renderAutofillPill(): string {
    if (!shouldShowAutofillFeatures(this.pageMode) && this.formDetection?.hasForm !== true && !isAtsSite(this.site)) {
      return ""
    }
    const det = this.formDetection
    if (!det) return ""
    if (!det.hasForm) {
      return `<span class="af-pill af-pill-none" title="No application form detected on this page.">Autofill not detected</span>`
    }
    if (det.supportsAutofill) {
      return `<span class="af-pill af-pill-supported" title="${escapeHtml(det.fields.length + " fields detected")}">Autofill supported</span>`
    }
    const reason = det.reasons[det.reasons.length - 1] ?? "Form detected but autofill is limited."
    return `<span class="af-pill af-pill-partial" title="${escapeHtml(reason)}">Autofill partial</span>`
  }

  private renderAutofillButton(): string {
    // Mode gate: hide the autofill button entirely on job-board pages and
    // unknown pages. ATS detail pages keep it hidden too — the button
    // surfaces only once we're on the actual application form (or when a
    // form was detected on a page we'd otherwise classify as job_board).
    if (
      !shouldShowAutofillFeatures(this.pageMode) &&
      this.formDetection?.hasForm !== true &&
      !isAtsSite(this.site)
    ) {
      return ""
    }
    const det = this.formDetection
    const hasForm = det?.hasForm === true
    const supports = det?.supportsAutofill === true

    // If this page isn't currently fill-capable (or detection says only
    // partial coverage), keep a read-only detected-fields entrypoint.
    if (this.autofillSiteSupported() === false || !supports) {
      if (!hasForm) {
        return `<button class="action" data-action="autofill" disabled title="No application form detected on this page.">Autofill</button>`
      }
      const open = this.detectionPanelOpen
      const label = open ? "Hide detected fields" : "View detected fields"
      const tooltip = !this.autofillSiteSupported()
        ? "Autofill is not available on this form yet."
        : "Form detected but profile-fillable fields are limited."
      return `<button class="action" data-action="toggle-detection" title="${escapeHtml(tooltip)}">${label}</button>`
    }

    if (this.autofillStatus === "loading") {
      return `<button class="action" data-action="autofill" disabled>Detecting…</button>`
    }
    if (this.autofillStatus === "preview") {
      return `<button class="action analyzed" data-action="autofill">Review fields</button>`
    }
    if (this.autofillStatus === "filling") {
      return `<button class="action" data-action="autofill" disabled>Filling…</button>`
    }
    if (this.autofillStatus === "done") {
      const anyFilled = (this.autofillResults ?? []).some((row) => row.filled)
      if (anyFilled) {
        return `<button class="action saved" data-action="autofill">✓ Filled</button>`
      }
      return `<button class="action analyzed" data-action="autofill">Review fields</button>`
    }
    if (this.autofillStatus === "error") {
      return `<button class="action error" data-action="autofill" title="${escapeHtml(this.autofillError ?? "Try again")}">Retry autofill</button>`
    }
    return `<button class="action" data-action="autofill">Autofill</button>`
  }

  // ── Proof prompt (post-submission capture) ──────────────────────────────────

  /**
   * No visible UI — confirmation detection auto-fires onSaveProof() to move
   * the matching application into the "applied" column silently. The method
   * is kept (instead of deleted) because the action dispatcher still wires
   * "save-proof" / "dismiss-proof" buttons that may be referenced elsewhere
   * for the error-recovery flow; if the auto-save fails, no UI surfaces it
   * (intentional — user requested silent behavior).
   */
  private renderProofPrompt(): string {
    return ""
  }

  // ── Detection panel (read-only) ─────────────────────────────────────────────

  /**
   * Read-only listing of every input we detected on the page. Surfaced for
   * sites where autofill isn't supported (or only partial) so the user can
   * still see what the bar saw. Never fills, edits, or submits.
   */
  private renderDetectionPanel(): string {
    if (!this.detectionPanelOpen) return ""
    const det = this.formDetection
    if (!det) return ""

    const summary = det.hasForm
      ? `${det.fields.length} field${det.fields.length === 1 ? "" : "s"} · ${det.formCount} form${det.formCount === 1 ? "" : "s"}`
      : "No form detected"

    const supportLabel = !det.hasForm
      ? `<span class="af-pill af-pill-none">Autofill not detected</span>`
      : det.supportsAutofill
      ? `<span class="af-pill af-pill-supported">Autofill supported</span>`
      : `<span class="af-pill af-pill-partial">Autofill partial</span>`

    const rows = det.fields
      .map((f) => {
        const required = f.required ? `<span class="dt-tag dt-tag-required">required</span>` : ""
        const conf = `<span class="dt-tag dt-tag-conf-${f.confidence}">${f.confidence}</span>`
        const type = f.type ? `<span class="dt-type">${escapeHtml(f.type)}</span>` : ""
        return `
          <div class="dt-row">
            <div class="dt-row-main">
              <div class="dt-row-label">${escapeHtml(f.label)}</div>
              <div class="dt-row-meta">
                ${type}
                ${f.name ? `<span class="dt-name">${escapeHtml(f.name)}</span>` : ""}
              </div>
            </div>
            <div class="dt-row-tags">
              ${required}
              ${conf}
            </div>
          </div>
        `
      })
      .join("")

    const reasons = det.reasons.length > 0
      ? `<ul class="dt-reasons">${det.reasons.map((r) => `<li>${escapeHtml(r)}</li>`).join("")}</ul>`
      : ""

    return `
      <div class="autofill-panel" role="dialog" aria-label="Detected fields">
        <div class="ap-header">
          <span class="ap-title">Detected Fields</span>
          <button class="ap-close" data-action="toggle-detection" aria-label="Close">×</button>
        </div>
        <div class="af-summary">
          <span class="af-summary-text">${escapeHtml(summary)}${det.detectedAts !== "unknown" ? ` · ${det.detectedAts}` : ""}</span>
          <div class="dt-support">${supportLabel}</div>
        </div>
        ${rows ? `<div class="af-list">${rows}</div>` : `<div class="af-progress">No fields to show.</div>`}
        ${reasons}
        <div class="af-actions">
          <button class="ap-action" data-action="toggle-detection">Close</button>
        </div>
      </div>
    `
  }

  // ── Autofill panel (preview + results) ─────────────────────────────────────

  private renderAutofillPanel(): string {
    // Open whenever we have something to show (preview, filling progress, or done).
    const list =
      this.autofillStatus === "preview" ? this.autofillPreview :
      this.autofillStatus === "done"    ? this.autofillResults :
      this.autofillStatus === "filling" ? this.autofillPreview :
      null
    if (!list) return ""

    const isPreview = this.autofillStatus === "preview"
    const isDone = this.autofillStatus === "done"
    const isFilling = this.autofillStatus === "filling"

    // Cover letter rows count toward "ready to fill" tally — they're attached
    // in a separate review step but the user thinks of them as one of N items.
    const willFill = list.filter((f) => f.valuePreview && !f.skippedReason).length
    const reviewCount = list.filter((f) => f.skippedReason).length

    const filledCount = isDone ? list.filter((f) => f.filled).length : 0
    const skippedCount = isDone ? list.filter((f) => !f.filled).length : 0

    const workdayRunningSummary = this.site === "workday" && this.workdaySnapshot
      ? `Step ${this.workdaySnapshot.step.index} of ${this.workdaySnapshot.step.total} · ${this.workdaySnapshot.step.name} · ${this.workdaySnapshot.progressPct}%`
      : null

    // Workday preview is multi-step — the per-section rows are estimates, not
    // a literal field-by-field plan. Show that intent in the header instead of
    // a flat "N ready to fill" which reads as if only N fields will be touched.
    const workdayPreviewSummary =
      this.site === "workday" && isPreview && this.autofillProfile
        ? `Multi-step autofill · ≈${estimateWorkdayAutofillFields(this.autofillProfile).total} fields, paused at Self-Identify + Review`
        : null

    const headerSummary = workdayRunningSummary ?? workdayPreviewSummary ?? (isDone
      ? `${filledCount} filled · ${skippedCount} need review`
      : `${willFill} ready to fill · ${reviewCount} need review`)

    return `
      <div class="autofill-panel" role="dialog" aria-label="Autofill review">
        <div class="ap-header">
          <span class="ap-title">${isDone ? "Autofill Results" : "Autofill Preview"}</span>
          <button class="ap-close" data-action="autofill-cancel" aria-label="Close">×</button>
        </div>
        <div class="af-summary">
          <span class="af-summary-text">${escapeHtml(headerSummary)}</span>
          ${this.autofillProfile === null && isPreview
            ? `<span class="af-warn">No saved profile — fill your autofill profile in Hireoven first.</span>`
            : ""}
        </div>
        <div class="af-list">${list.map((f) => this.renderAutofillRow(f, isDone)).join("")}</div>
        ${this.renderCoverLetterSection(list, isDone)}
        ${isPreview ? `
          <div class="af-actions">
            <button class="ap-action" data-action="autofill-cancel">Cancel</button>
            <button
              class="ap-action ap-action-primary"
              data-action="autofill-confirm"
              ${willFill === 0 ? "disabled" : ""}
            >${willFill === 0 ? "Nothing to fill" : `Confirm fill (${willFill})`}</button>
          </div>
        ` : ""}
        ${isDone ? `
          <div class="af-actions">
            <button class="ap-action" data-action="autofill-cancel">Done</button>
          </div>
        ` : ""}
        ${isFilling ? `<div class="af-progress">Filling fields…</div>` : ""}
      </div>
    `
  }

  /**
   * Cover letter review pane — only shown when the form has a cover-letter
   * upload slot AND we've finished the regular profile fill (so the user
   * sees the regular fill progress first, then the cover-letter step).
   */
  private renderCoverLetterSection(list: AutofillFieldResult[], isDone: boolean): string {
    const hasCoverSlot = list.some((f) => f.source === "cover_letter")
    if (!hasCoverSlot) return ""
    // Only show during/after the fill — preview-only state stays minimal.
    if (!isDone && this.coverLetterStatus === "idle") return ""

    const status = this.coverLetterStatus
    const body = this.coverLetterBody ?? ""

    const statusPill = (() => {
      switch (status) {
        case "generating": return `<span class="cl-pill cl-pill-progress">Generating…</span>`
        case "ready":      return `<span class="cl-pill cl-pill-ready">Ready to review</span>`
        case "saving":     return `<span class="cl-pill cl-pill-progress">Saving edits…</span>`
        case "attaching":  return `<span class="cl-pill cl-pill-progress">Attaching…</span>`
        case "attached":   return `<span class="cl-pill cl-pill-attached">✓ Attached</span>`
        case "error":      return `<span class="cl-pill cl-pill-error">${escapeHtml(this.coverLetterError ?? "Error")}</span>`
        default:           return ""
      }
    })()

    const showTextarea = status === "ready" || status === "saving" || status === "attaching" || status === "attached" || (status === "error" && body.length > 0)

    return `
      <div class="cl-section">
        <div class="cl-section-header">
          <span class="cl-section-title">Cover Letter</span>
          ${statusPill}
        </div>
        ${status === "generating"
          ? `<div class="cl-skeleton"><div></div><div></div><div></div></div>`
          : ""}
        ${showTextarea
          ? `<textarea
               class="cl-textarea"
               data-cl-textarea="1"
               spellcheck="true"
               aria-label="Cover letter draft"
             >${escapeHtml(body)}</textarea>`
          : ""}
        ${status === "error" && !body
          ? `<div class="cl-error-empty">${escapeHtml(this.coverLetterError ?? "Generation failed")}</div>`
          : ""}
        <div class="cl-actions" data-cl-actions>
          ${this.renderCoverLetterActionButtons()}
        </div>
      </div>
    `
  }

  private renderCoverLetterActionButtons(): string {
    const status = this.coverLetterStatus
    const hasBody = !!this.coverLetterBody
    const dirty = this.coverLetterDirty

    if (status === "idle") {
      return `<button class="ap-action ap-action-primary" data-action="cl-generate">Generate cover letter</button>`
    }
    if (status === "generating") {
      return `<button class="ap-action" disabled>Generating…</button>`
    }
    if (status === "saving") {
      return `<button class="ap-action" disabled>Saving…</button>`
    }
    if (status === "attaching") {
      return `<button class="ap-action" disabled>Attaching…</button>`
    }
    if (status === "attached") {
      return `
        <button class="ap-action" data-action="cl-regenerate">Regenerate</button>
        <button class="ap-action ap-action-saved" disabled>✓ Attached</button>
      `
    }
    if (status === "error" && !hasBody) {
      return `<button class="ap-action ap-action-primary" data-action="cl-regenerate">Try again</button>`
    }
    // ready (or error with a body present)
    return `
      <button class="ap-action" data-action="cl-regenerate">Regenerate</button>
      ${dirty ? `<button class="ap-action" data-action="cl-save">Save edits</button>` : ""}
      <button class="ap-action ap-action-primary" data-action="cl-attach" ${!hasBody ? "disabled" : ""}>Attach to form</button>
    `
  }

  private renderAutofillRow(f: AutofillFieldResult, isDone: boolean): string {
    let statusLabel = ""
    let statusClass = "af-row-pending"
    // Cover-letter rows are owned by the dedicated review section below — they
    // stay in "Review below" state until the user explicitly attaches.
    if (f.source === "cover_letter") {
      statusLabel = f.filled ? "Attached" : "Review below"
      statusClass = f.filled ? "af-row-filled" : "af-row-pending"
    } else if (isDone) {
      if (f.filled) {
        statusLabel = "Filled"
        statusClass = "af-row-filled"
      } else {
        statusLabel = "Skipped"
        statusClass = "af-row-skipped"
      }
    } else if (f.skippedReason) {
      statusLabel = "Needs review"
      statusClass = "af-row-skipped"
    } else {
      statusLabel = "Will fill"
      statusClass = "af-row-pending"
    }

    const isCustomQuestion = f.skippedReason === "Custom question — answer manually."
    const aiState = f.selector ? this.aiAnswers.get(f.selector) : undefined

    let aiWidget = ""
    if (isCustomQuestion && f.selector && !isDone) {
      if (!aiState) {
        aiWidget = `<button class="af-ai-btn" data-action="ai-answer" data-selector="${escapeHtml(f.selector)}" data-label="${escapeHtml(f.label)}">✦ AI Answer</button>`
      } else if (aiState.status === "loading") {
        aiWidget = `<button class="af-ai-btn" disabled>Answering…</button>`
      } else if (aiState.status === "error") {
        aiWidget = `<div class="af-ai-error">${escapeHtml(aiState.error ?? "Failed — try again.")}</div>
          <button class="af-ai-btn" data-action="ai-answer" data-selector="${escapeHtml(f.selector)}" data-label="${escapeHtml(f.label)}">Retry</button>`
      } else if (aiState.status === "done" && aiState.answer) {
        aiWidget = `
          <div class="af-ai-answer-text">${escapeHtml(aiState.answer)}</div>
          <button class="af-ai-btn af-ai-fill" data-action="ai-fill" data-selector="${escapeHtml(f.selector)}" data-answer="${escapeHtml(aiState.answer)}">Fill it ↗</button>`
      }
    }

    return `
      <div class="af-row ${statusClass}">
        <div class="af-row-main">
          <div class="af-row-label">${escapeHtml(f.label)}</div>
          <div class="af-row-value">
            ${f.valuePreview ? escapeHtml(f.valuePreview) : `<em>${escapeHtml(f.skippedReason ?? "—")}</em>`}
          </div>
          ${aiWidget}
        </div>
        <div class="af-row-status">${escapeHtml(statusLabel)}</div>
      </div>
    `
  }

  // ── Analysis result panel ───────────────────────────────────────────────────

  private renderAnalysisPanel(): string {
    if (!this.analysisOpen || !this.analysis) return ""

    return `
      <div class="analysis-panel" role="dialog" aria-label="Job analysis">
        <div class="ap-header">
          <span class="ap-title">Analysis</span>
          <button class="ap-close" data-action="toggle-analysis" aria-label="Close panel">×</button>
        </div>

        ${this.renderOverview()}
        ${this.renderSignalsBySection()}
        ${this.renderPanelActions()}
      </div>
    `
  }

  // ── Section 1: Overview ────────────────────────────────────────────────────
  private renderOverview(): string {
    const a = this.analysis
    if (!a) return ""

    const rows: string[] = []

    if (typeof a.matchScore === "number") {
      rows.push(this.apRow("Match score", `${a.matchScore}%`, "ap-val-strong"))
    }

    const sourceLabel = a.detectedAts ?? "Unknown"
    rows.push(this.apRow("Source", sourceLabel))

    rows.push(this.apRow(
      "Autofill",
      a.autofillSupported ? "Supported" : "Not supported",
      a.autofillSupported ? "ap-val-pos" : "ap-val-muted",
    ))

    const existsText = a.existsInHireoven
      ? (this.alreadySaved ? "Saved by you" : "Tracked in Hireoven")
      : "Not yet tracked"
    rows.push(this.apRow("In Hireoven", existsText, a.existsInHireoven ? "ap-val-pos" : "ap-val-muted"))

    return `
      <section class="ap-section">
        <h3 class="ap-section-title">Overview</h3>
        <div class="ap-rows">${rows.join("")}</div>
      </section>
    `
  }

  private apRow(key: string, value: string, valClass = ""): string {
    return `
      <div class="ap-row">
        <span class="ap-key">${escapeHtml(key)}</span>
        <span class="ap-val ${valClass}">${escapeHtml(value)}</span>
      </div>
    `
  }

  // ── Section 2: Signals (grouped, with evidence drawer) ─────────────────────

  private renderSignalsBySection(): string {
    const a = this.analysis
    if (!a) return ""

    // Group signals by category (preserves backend-returned order within each group).
    const groupOrder: Array<{ key: ExtensionJobAnalysis["signals"][number]["type"]; label: string }> = [
      { key: "matched_skill", label: "Matched skills" },
      { key: "missing_skill", label: "Missing skills" },
      { key: "salary",        label: "Compensation" },
      { key: "work_mode",     label: "Work mode" },
      { key: "location",      label: "Location" },
      { key: "sponsorship",   label: "Sponsorship" },
      { key: "ghost_risk",    label: "Ghost risk" },
      { key: "requirement",   label: "Requirements" },
    ]

    // Build group HTML for non-empty groups only — never invent placeholders.
    const groupsHtml = groupOrder
      .map((group) => {
        const groupSignals = a.signals
          .map((s, i) => ({ s, i }))
          .filter(({ s }) => s.type === group.key)
        if (groupSignals.length === 0) return ""
        const chips = groupSignals
          .map(({ s, i }) => this.renderSignalChip(s, i))
          .join("")
        return `
          <div class="ap-group">
            <div class="ap-group-label">${escapeHtml(group.label)}</div>
            <div class="ap-chips">${chips}</div>
          </div>
        `
      })
      .filter(Boolean)
      .join("")

    if (!groupsHtml) {
      return `
        <section class="ap-section">
          <h3 class="ap-section-title">Signals</h3>
          <div class="ap-empty">No signals detected from the job description yet.</div>
        </section>
      `
    }

    return `
      <section class="ap-section">
        <h3 class="ap-section-title">Signals</h3>
        ${groupsHtml}
      </section>
    `
  }

  private renderSignalChip(
    signal: ExtensionJobAnalysis["signals"][number],
    index: number,
  ): string {
    const expanded = this.expandedSignalIndex === index
    const conf = signal.confidence
    return `
      <div class="ap-signal" data-expanded="${expanded ? "true" : "false"}">
        <button
          class="ap-chip ap-chip-${signal.type}"
          data-action="toggle-signal"
          data-signal-idx="${index}"
          aria-expanded="${expanded ? "true" : "false"}"
        >
          <span class="ap-chip-label">${escapeHtml(signal.label)}</span>
          <span class="ap-chip-conf ap-chip-conf-${conf}" aria-label="confidence ${conf}">${conf[0]}</span>
          <span class="ap-chip-caret">${expanded ? "▴" : "▾"}</span>
        </button>
        ${expanded ? this.renderEvidenceDrawer(signal) : ""}
      </div>
    `
  }

  private renderEvidenceDrawer(
    signal: ExtensionJobAnalysis["signals"][number],
  ): string {
    if (!signal.evidence?.trim()) {
      return `
        <div class="ap-evidence ap-evidence-empty">
          No evidence found yet.
        </div>
      `
    }
    return `
      <div class="ap-evidence">
        <div class="ap-evidence-label">Evidence</div>
        <blockquote class="ap-evidence-text">${escapeHtml(signal.evidence)}</blockquote>
      </div>
    `
  }

  // ── Section 3: Actions ─────────────────────────────────────────────────────

  private renderPanelActions(): string {
    const a = this.analysis
    if (!a) return ""

    const dashboardUrl =
      this.saveResult?.dashboardUrl ?? this.existingDashboardUrl ?? null

    // Save: show only when the user hasn't saved yet (server-truth via canSave).
    // After a fresh save, swap to a confirmed state instead.
    const saveBtn = (() => {
      if (this.saveStatus === "saved") {
        return `<button class="ap-action ap-action-saved" data-action="open-dashboard">✓ Saved</button>`
      }
      if (this.saveStatus === "loading") {
        return `<button class="ap-action ap-action-primary" disabled>Saving…</button>`
      }
      if (a.actions.canSave) {
        return `<button class="ap-action ap-action-primary" data-action="save">Save</button>`
      }
      return "" // already saved → button is hidden entirely (matches bar behavior)
    })()

    // Tailor is enabled whenever we have an extracted job; the click handler
    // saves implicitly when needed, then runs preview+approve inline (no
    // redirect to the web app). On success the autofill below will pick up
    // the tailored resume version automatically.
    const tailorBtn = (() => {
      if (this.tailorStatus === "loading") {
        return `<button class="ap-action" disabled>Tailoring…</button>`
      }
      if (this.tailorStatus === "done") {
        if (this.tailorSnapStatus === "snapping") {
          return `<button class="ap-action ap-action-saved" disabled>Snapping…</button>`
        }
        if (this.tailorSnapStatus === "snapped") {
          const tip = this.site === "workday"
            ? "Tailored resume saved. It will attach during Workday My Experience autofill."
            : this.tailorMatchScore !== null
              ? `Tailored resume saved · ${this.tailorMatchScore}% match`
              : "Tailored resume saved"
          return `<button class="ap-action ap-action-saved" disabled title="${escapeHtml(tip)}">✓ Tailored</button>`
        }
        const snapTip = this.tailorSnapError
          ? `Tailored resume saved. ${this.tailorSnapError}`
          : "Tailored resume saved. Click to snap it into this form."
        return `<button class="ap-action ap-action-saved" data-action="snap-resume" title="${escapeHtml(snapTip)}">Snap Resume</button>`
      }
      if (this.tailorStatus === "error") {
        return `<button class="ap-action ap-action-saved" data-action="tailor" title="${escapeHtml(this.tailorError ?? "Try again")}">Retry tailor</button>`
      }
      return `<button class="ap-action" data-action="tailor">Tailor Resume</button>`
    })()

    // Panel's Autofill button mirrors the bar's behavior. Click triggers the
    // preview flow regardless of where the click came from (bar or panel).
    const autofillBtn = (() => {
      if (!this.autofillSiteSupported()) {
        return `<button class="ap-action" data-action="autofill" disabled title="Autofill is not available on this form yet.">Autofill</button>`
      }
      if (this.autofillStatus === "loading" || this.autofillStatus === "filling") {
        return `<button class="ap-action" disabled>${this.autofillStatus === "loading" ? "Detecting…" : "Filling…"}</button>`
      }
      if (this.autofillStatus === "done") {
        const anyFilled = (this.autofillResults ?? []).some((row) => row.filled)
        if (anyFilled) {
          return `<button class="ap-action ap-action-saved" data-action="autofill">✓ Filled</button>`
        }
        return `<button class="ap-action" data-action="autofill">Review fields</button>`
      }
      return `<button class="ap-action" data-action="autofill">Autofill</button>`
    })()

    const dashboardBtn = dashboardUrl
      ? `<button class="ap-action ap-action-link" data-action="open-dashboard">Open in Hireoven →</button>`
      : ""

    return `
      <section class="ap-section ap-section-actions">
        <h3 class="ap-section-title">Actions</h3>
        <div class="ap-actions">
          ${saveBtn}
          ${tailorBtn}
          ${autofillBtn}
          ${dashboardBtn}
        </div>
      </section>
    `
  }

  private bindEvents(): void {
    if (!this.root) return
    this.root.addEventListener("click", (event) => {
      const target = event.target as HTMLElement | null
      const actionEl = target?.closest("[data-action]")
      if (!actionEl) return
      const action = actionEl.getAttribute("data-action")
      if (action === "minimize") {
        this.minimized = true
        this.persistMinimized()
        this.render()
      } else if (action === "restore") {
        this.minimized = false
        this.persistMinimized()
        this.render()
      } else if (action === "debug") {
        this.debugOpen = !this.debugOpen
        this.render()
      } else if (action === "save") {
        void this.onSave()
      } else if (action === "analyze") {
        void this.onAnalyze()
      } else if (action === "tailor") {
        void this.onTailor()
      } else if (action === "snap-resume") {
        void this.onSnapTailoredResume()
      } else if (action === "autofill") {
        void this.onAutofillPreview()
      } else if (action === "autofill-confirm") {
        void this.onAutofillConfirm()
      } else if (action === "autofill-cancel") {
        this.onAutofillCancel()
      } else if (action === "toggle-detection") {
        this.detectionPanelOpen = !this.detectionPanelOpen
        this.render()
      } else if (action === "save-proof") {
        void this.onSaveProof()
      } else if (action === "dismiss-proof") {
        this.onDismissProofPrompt()
      } else if (action === "cl-generate") {
        void this.onGenerateCoverLetter()
      } else if (action === "cl-regenerate") {
        void this.onGenerateCoverLetter({ regenerate: true })
      } else if (action === "cl-save") {
        void this.onSaveCoverLetterEdits()
      } else if (action === "cl-attach") {
        void this.onAttachCoverLetter()
      } else if (action === "ai-answer") {
        const selector = actionEl.getAttribute("data-selector") ?? ""
        const label = actionEl.getAttribute("data-label") ?? ""
        if (selector) void this.onAiAnswer(selector, label)
      } else if (action === "ai-fill") {
        const selector = actionEl.getAttribute("data-selector") ?? ""
        const answer = actionEl.getAttribute("data-answer") ?? ""
        if (selector && answer) this.onAiFill(selector, answer)
      } else if (action === "toggle-analysis") {
        this.analysisOpen = !this.analysisOpen
        this.render()
      } else if (action === "open-dashboard") {
        // Prefer the URL from the most recent save; fall back to the existence
        // check's URL when this is an already-saved job (no fresh save in flight).
        const url = this.saveResult?.dashboardUrl ?? this.existingDashboardUrl
        if (url) window.open(url, "_blank", "noopener")
      } else if (action === "toggle-signal") {
        const raw = actionEl.getAttribute("data-signal-idx")
        const idx = raw === null ? -1 : parseInt(raw, 10)
        if (Number.isFinite(idx) && idx >= 0) {
          this.expandedSignalIndex = this.expandedSignalIndex === idx ? null : idx
          this.render()
        }
      }
      // tailor / autofill remain inert until later steps wire them.
    })

    // Capture edits to the cover-letter textarea without re-rendering on every
    // keystroke (would lose caret position). We just stash the new text on the
    // instance; the user clicks "Save edits" to persist.
    this.root.addEventListener("input", (event) => {
      const target = event.target as HTMLElement | null
      if (!target || target.tagName !== "TEXTAREA") return
      if (target.getAttribute("data-cl-textarea") !== "1") return
      const next = (target as HTMLTextAreaElement).value
      if (next !== this.coverLetterBody) {
        this.coverLetterBody = next
        this.coverLetterDirty = true
        // Light re-render to enable the Save button — but only update the
        // button bar, not the textarea, to preserve focus + selection.
        this.refreshCoverLetterActions()
      }
    })
  }

  public async executeApexCommand(command: string, payload?: Record<string, unknown>): Promise<{ handled: boolean; waiting?: boolean }> {
    if (command === "OPEN_AUTOFILL") {
      await this.onAutofillPreview()
      return { handled: true }
    }
    if (command === "START_TAILOR") {
      await this.onTailor()
      return { handled: true }
    }
    if (command === "START_COMPARE" || command === "START_WORKFLOW") {
      let url = this.saveResult?.dashboardUrl ?? this.existingDashboardUrl
      if (!url && this.state === "ready" && this.job) {
        await this.onSave()
        url = this.saveResult?.dashboardUrl ?? this.existingDashboardUrl
      }
      if (url) window.open(url, "_blank", "noopener")
      return { handled: true }
    }
    if (command === "AGENT_AUTOFILL") {
      return await this.runAgentAutofill(payload)
    }
    return { handled: false }
  }

  private toAutofillSource(): AutofillSource {
    switch (this.site) {
      case "greenhouse":
      case "lever":
      case "workday":
      case "ashby":
      case "icims":
      case "smartrecruiters":
      case "bamboohr":
        return this.site
      default:
        return "generic"
    }
  }

  private currentAutofillJobId(): string | undefined {
    return this.knownJobId ?? this.analysis?.jobId ?? this.saveResult?.jobId ?? undefined
  }

  private summarizeAutofillRows(rows: AutofillFieldResult[] | null): {
    fillableCount: number
    filledCount: number
    manualReviewCount: number
  } {
    const list = rows ?? []
    const fillableCount = list.filter(
      (row) => !row.skippedReason && row.source !== "manual_required" && row.source !== "cover_letter",
    ).length
    const filledCount = list.filter((row) => row.filled).length
    const manualReviewCount = list.filter((row) => Boolean(row.skippedReason)).length
    return { fillableCount, filledCount, manualReviewCount }
  }

  private async logAutofillTelemetry(args: {
    stage: "preview" | "attempt" | "success" | "partial" | "error"
    fieldsFilled?: number
    fieldsTotal?: number
    manualReviewCount?: number
    errorMessage?: string
    fallbackUsed?: boolean
  }): Promise<void> {
    try {
      await trackAutofillTelemetry({
        jobId: this.currentAutofillJobId(),
        companyName: this.job?.company ?? undefined,
        jobTitle: this.job?.title ?? undefined,
        atsType: this.toAutofillSource(),
        stage: args.stage,
        fieldsFilled: args.fieldsFilled,
        fieldsTotal: args.fieldsTotal,
        manualReviewCount: args.manualReviewCount,
        errorMessage: args.errorMessage,
        pageUrl: location.href,
        fallbackUsed: args.fallbackUsed,
      })
    } catch {
      // telemetry is best-effort only
    }
  }

  private async tryWorkdayGenericFallback(): Promise<{
    rows: AutofillFieldResult[]
    fillableCount: number
    filledCount: number
    manualReviewCount: number
  } | null> {
    if (!this.autofillProfile) return null

    const preview = buildAutofillPreview("workday", this.autofillProfile, document)
    const needsResume = preview.some((f) => f.source === "resume" && !f.skippedReason)

    let resumeBytes: { base64: string; filename: string } | null = null
    if (needsResume) {
      try {
        resumeBytes = await fetchPrimaryResume({
          versionId: this.tailoredResumeVersionId ?? undefined,
          resumeId: this.tailoredResumeId ?? undefined,
          jobId: this.currentAutofillJobId(),
        })
      } catch {
        resumeBytes = null
      }
    }

    const rows = await applySafeFills("workday", this.autofillProfile, resumeBytes, document)
    const summary = this.summarizeAutofillRows(rows)
    return {
      rows,
      fillableCount: summary.fillableCount,
      filledCount: summary.filledCount,
      manualReviewCount: summary.manualReviewCount,
    }
  }

  private requiredFieldFillNotesToRows(notes: RequiredFieldFillNote[]): AutofillFieldResult[] {
    return notes.map((note) => ({
      label: note.label,
      valuePreview: note.valuePreview,
      confidence: note.filled ? "medium" : "needs_review",
      source: note.filled ? "profile" : "manual_required",
      filled: note.filled,
      skippedReason: note.skippedReason,
    }))
  }

  private shouldRunRequiredQuestionCleanup(): boolean {
    return this.site !== "workday" && this.autofillSiteSupported()
  }

  private async runRequiredQuestionCleanup(): Promise<{
    attemptedCount: number
    filledCount: number
    manualReviewCount: number
  }> {
    if (!this.shouldRunRequiredQuestionCleanup() || !this.autofillProfile) {
      return { attemptedCount: 0, filledCount: 0, manualReviewCount: 0 }
    }

    const summary = await fillRequiredAtsFields({
      profile: this.autofillProfile,
      doc: document,
      matchQuestions: async (questions) => {
        if (questions.length === 0) return []
        const result = await matchQuestions({
          questions,
          jobTitle: this.job?.title ?? undefined,
          company: this.job?.company ?? undefined,
        })
        return result.answers
      },
    })

    if (summary.notes.length > 0) {
      const existing = this.autofillResults ?? []
      this.autofillResults = [
        ...existing,
        ...this.requiredFieldFillNotesToRows(summary.notes),
      ]
      this.render()
    }

    return {
      attemptedCount: summary.attemptedCount,
      filledCount: summary.filledCount,
      manualReviewCount: summary.manualReviewCount,
    }
  }

  private isConfirmationPage(): boolean {
    const conf = detectConfirmation(document)
    this.confirmation = conf
    return conf.isConfirmation && conf.confidence !== "low"
  }

  // Detects login / account-creation pages so the agent can wait instead of
  // failing. Checks URL patterns first (cheapest), then DOM.
  private isLoginOrAccountPage(): boolean {
    const url = location.href.toLowerCase()
    const LOGIN_URL_RE = /\/(login|signin|sign-in|auth|sso|register|signup|sign-up|create-account|account\/create|create-profile|join|onboard)/
    if (LOGIN_URL_RE.test(url)) return true

    // Workday gates almost every application behind sign-in / account creation
    // first — pause on those instead of trying to "fill" the auth form as if it
    // were the application. (See isWorkdayAuthPage for the exact signals.)
    if (isWorkdayAuthPage()) return true

    // Password field present but no recognisable application form → login page.
    const hasPassword = !!document.querySelector('input[type="password"]')
    if (!hasPassword) return false
    const hasAppForm = !!document.querySelector([
      "#grnhse_app", "form.application-form", "#icims_content form",
      ".sr-application-form", "#bamboohr-apply",
      '[data-automation-id="applyStep"]', 'form[action*="apply"]',
      'form[action*="boards"]',
    ].join(","))
    return !hasAppForm
  }

  /**
   * On an ATS job posting (no form yet), click the apply CTA — "I'm interested",
   * "Apply", "Apply now" — to navigate to the actual application form. Returns
   * true if it clicked something.
   */
  private tryClickApplyCta(): boolean {
    const CTA_RE = /^(i'?m interested|apply now|apply for this job|apply online|apply|start application|continue|get started)$/
    const candidates = Array.from(
      document.querySelectorAll<HTMLElement>(
        'a[href], button, [role="button"], [data-test*="apply" i], [data-ui*="apply" i]',
      ),
    ).filter((el) => {
      if (!isActionableButton(el)) return false
      const text = (el.textContent ?? el.getAttribute("aria-label") ?? el.getAttribute("value") ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase()
      if (!text) return false
      // Avoid "apply filters" / "apply to saved" style false positives.
      if (/filter|search|sign in|log ?in|save|share/.test(text)) return false
      return CTA_RE.test(text)
    })
    if (candidates.length === 0) return false
    // Prefer an explicit "I'm interested"/"Apply" over generic "Continue".
    const score = (el: HTMLElement): number => {
      const t = (el.textContent ?? "").toLowerCase()
      if (t.includes("interested")) return 100
      if (t.includes("apply")) return 90
      if (t.includes("start application")) return 70
      if (t.includes("get started")) return 50
      return 10
    }
    candidates.sort((a, b) => score(b) - score(a))
    const cta = candidates[0]
    try {
      cta.scrollIntoView({ block: "center" })
    } catch {
      // best-effort
    }
    cta.click()
    return true
  }

  /**
   * Stop-at-review: visually flag the page's real submit button and scroll it
   * into view so the user can give a 1-click confirm. Styling is applied to the
   * page DOM (not the shadow root) via a page-level <style>, matching the same
   * `.ho-submit-highlight` convention the legacy review panel used.
   */
  private highlightSubmitButton(): HTMLElement | null {
    if (!document.getElementById("ho-submit-highlight-style")) {
      const style = document.createElement("style")
      style.id = "ho-submit-highlight-style"
      style.textContent = `
        .ho-submit-highlight {
          outline: 2.5px solid #10b981 !important;
          outline-offset: 3px !important;
          box-shadow: 0 0 0 4px rgba(16,185,129,0.18) !important;
          animation: ho-submit-pulse 1.8s ease-in-out infinite !important;
        }
        @keyframes ho-submit-pulse {
          0%, 100% { box-shadow: 0 0 0 4px rgba(16,185,129,0.18); }
          50%       { box-shadow: 0 0 0 8px rgba(16,185,129,0.06); }
        }`
      document.head.appendChild(style)
    }
    const btn = this.findBestActionButton("submit")
    if (!btn) return null
    btn.classList.add("ho-submit-highlight")
    try {
      btn.scrollIntoView({ behavior: "smooth", block: "center" })
    } catch {
      // best-effort
    }
    return btn
  }

  private clearSubmitHighlight(): void {
    document
      .querySelectorAll(".ho-submit-highlight")
      .forEach((el) => el.classList.remove("ho-submit-highlight"))
  }

  private findBestActionButton(kind: "next" | "submit"): HTMLElement | null {
    const selectors =
      kind === "submit"
        ? [
            'button[type="submit"]',
            'input[type="submit"]',
            'button[data-qa="btn-submit"]',
            '[data-automation-id*="submit"]',
            'button[data-testid*="submit"]',
            'button[aria-label*="submit" i]',
            'button[aria-label*="apply" i]',
          ]
        : [
            '[data-automation-id="pageFooterNextButton"]',
            '[data-automation-id="saveAndContinueButton"]',
            '[data-automation-id*="nextButton"]',
            '[data-automation-id*="saveAndContinue"]',
            'button[aria-label*="next" i]',
            'button[aria-label*="continue" i]',
          ]

    const fromSelectors = selectors
      .flatMap((selector) => Array.from(document.querySelectorAll(selector)))
      .filter((el): el is HTMLElement => isActionableButton(el))

    const fromText = Array.from(document.querySelectorAll<HTMLElement>("button, [role='button'], input[type='submit']"))
      .filter((el) => isActionableButton(el))
      .filter((el) => {
        const text = `${el.textContent ?? ""} ${el.getAttribute("value") ?? ""}`.toLowerCase()
        if (!text.trim()) return false
        if (kind === "submit") {
          return /submit|apply|finish|complete|send application|review and submit/.test(text)
        }
        if (/submit|apply now|review and submit/.test(text)) return false
        return /next|continue|save and continue|review/.test(text)
      })

    const candidates = [...fromSelectors, ...fromText]
    if (candidates.length === 0) return null

    const score = (el: HTMLElement): number => {
      const text = `${el.textContent ?? ""} ${el.getAttribute("value") ?? ""}`.toLowerCase()
      let s = 0
      if (kind === "submit") {
        if (text.includes("review and submit")) s += 100
        if (text.includes("submit")) s += 80
        if (text.includes("apply")) s += 60
        if (text.includes("finish") || text.includes("complete")) s += 40
      } else {
        if (text.includes("save and continue")) s += 100
        if (text === "next" || text.includes(" next")) s += 80
        if (text.includes("continue")) s += 60
        if (text.includes("review")) s += 40
      }
      if (el.matches("button[type='submit'], input[type='submit']")) s += kind === "submit" ? 30 : -20
      return s
    }

    candidates.sort((a, b) => score(b) - score(a))
    return candidates[0] ?? null
  }

  private async clickAndWaitForProgress(button: HTMLElement, timeoutMs = 12000): Promise<boolean> {
    const before = pageSignature()
    try {
      button.scrollIntoView({ block: "center", inline: "nearest" })
    } catch {
      // best-effort
    }
    // Brief, jittered settle before clicking. Instant click-after-fill is a bot
    // tell for anti-automation systems (DataDome) and risks an IP block.
    await sleep(280 + Math.round(Math.random() * 420))
    button.click()

    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      if (this.isConfirmationPage()) return true
      // A blocked submit renders a validation summary. That changes the page text
      // (so pageSignature() flips) but it is NOT progress — returning false here
      // is what lets the agent loop hand off instead of re-clicking Submit in a
      // tight loop (the Ashby "tries to submit again and again" bug).
      if (this.hasBlockingValidationErrors()) return false
      if (pageSignature() !== before) {
        // Page changed but it's neither a confirmation nor (yet) an error summary.
        // Give a validation banner a beat to render before calling it a real
        // step advance, so we don't mistake a rejection for forward progress.
        await sleep(450)
        if (this.hasBlockingValidationErrors()) return false
        return true
      }
      await sleep(220)
    }
    return this.isConfirmationPage()
  }

  /**
   * True when the form is showing a validation summary for missing/required
   * fields after a submit attempt — i.e. the submit was rejected. Used to stop
   * the agent from treating a rejection as progress and re-submitting in a loop.
   */
  private hasBlockingValidationErrors(): boolean {
    if (this.ashbyValidationErrors().length > 0) return true
    const alerts = Array.from(
      document.querySelectorAll<HTMLElement>(
        '[role="alert"], [aria-live="assertive"], [class*="errorsContainer" i], [class*="error" i][class*="summary" i]',
      ),
    )
    return alerts.some((el) => {
      const visible = el.offsetParent !== null || el.getClientRects().length > 0
      if (!visible) return false
      const text = (el.textContent ?? "").toLowerCase()
      return /\b(required field|missing entry|this field is required|is required|please (correct|complete|fill)|needs? correction)\b/.test(
        text,
      )
    })
  }

  private async maybeSaveProofAutomatically(): Promise<void> {
    if (!this.isConfirmationPage()) return
    try {
      await this.onSaveProof()
    } catch {
      // best-effort only
    }
  }

  /**
   * Ashby renders a validation summary (role="alert", `…errorsContainer…`) after
   * a blocked submit, listing each missing required field. Returns those field
   * labels so the agent can hand off with a precise "these still need you" note
   * instead of thrashing the Submit button.
   */
  private ashbyValidationErrors(): string[] {
    const container = document.querySelector<HTMLElement>(
      '[class*="errorsContainer" i], [role="alert"][aria-live="assertive"]',
    )
    if (!container) return []
    const nodes = Array.from(
      container.querySelectorAll<HTMLElement>('[class*="errorFieldLink" i], li button, li p'),
    )
    const labels = nodes
      .map((el) => (el.textContent ?? "").replace(/^\s*Missing entry for required field:\s*/i, "").trim())
      .filter((text) => text.length > 0 && text.length < 200)
    return Array.from(new Set(labels))
  }

  private async runGenericAgentLoop(maxTransitions = 10): Promise<AgentLoopResult> {
    for (let i = 0; i < maxTransitions; i += 1) {
      if (this.isConfirmationPage()) return { submitted: true }

      await this.onAutofillPreview()
      if (this.autofillStatus === "preview") {
        await this.onAutofillConfirm()
      }
      if (this.autofillStatus === "error") {
        return { submitted: false, reason: this.autofillError ?? "Autofill failed." }
      }

      if (this.coverLetterSelector && this.coverLetterId) {
        await this.onAttachCoverLetter()
      }

      await this.runRequiredQuestionCleanup()

      if (this.isConfirmationPage()) return { submitted: true }

      // HARD GUARD: never click Submit while required fields are still empty.
      // The agent was hitting Submit on a half-filled (or empty) form and
      // tripping the ATS validator. Try one more cleanup pass, then hand off
      // cleanly with the exact list instead of submitting an incomplete form.
      let missingRequired = findUnfilledRequiredFields(document)
      if (missingRequired.length > 0) {
        await this.runRequiredQuestionCleanup()
        missingRequired = findUnfilledRequiredFields(document)
      }
      if (missingRequired.length > 0) {
        const shown = missingRequired.slice(0, 5).join(", ")
        return {
          submitted: false,
          reason: `Filled what I can — ${missingRequired.length} required field${missingRequired.length === 1 ? "" : "s"} still need you: ${shown}${missingRequired.length > 5 ? ", …" : ""}. Review and submit.`,
        }
      }

      const submitButton = this.findBestActionButton("submit")
      if (submitButton) {
        const progressed = await this.clickAndWaitForProgress(submitButton)
        if (this.isConfirmationPage()) return { submitted: true }
        // Some ATSes prompt for sign-in / account creation AFTER submit. Pause
        // for login rather than looping; the post-login re-trigger records it.
        if (this.isLoginOrAccountPage()) {
          return {
            submitted: false,
            needsLogin: true,
            reason: "Sign in to finish submitting your application.",
          }
        }
        if (progressed) continue
        const cleanup = await this.runRequiredQuestionCleanup()
        if (cleanup.filledCount > 0) {
          const retrySubmit = this.findBestActionButton("submit")
          if (retrySubmit) {
            const retryProgressed = await this.clickAndWaitForProgress(retrySubmit)
            if (this.isConfirmationPage()) return { submitted: true }
            if (retryProgressed) continue
          }
        }
        // Submit didn't progress and the form is showing validation errors for
        // required fields we won't/can't auto-answer (citizenship, EEO, etc.).
        // Hand off cleanly with the exact list instead of re-clicking Submit or
        // returning a misleading "no submit button" — this is the "fill safe +
        // stop" terminal state.
        const blocking = this.ashbyValidationErrors()
        if (blocking.length > 0) {
          const shown = blocking.slice(0, 4).join(", ")
          return {
            submitted: false,
            reason: `Filled what I safely can. ${blocking.length} required field${blocking.length === 1 ? "" : "s"} still need you: ${shown}${blocking.length > 4 ? ", …" : ""}. Review and submit.`,
          }
        }
      }

      const nextButton = this.findBestActionButton("next")
      if (!nextButton) {
        return { submitted: false, reason: "No Continue/Submit button was found after autofill." }
      }
      const nextProgressed = await this.clickAndWaitForProgress(nextButton)
      if (!nextProgressed) {
        const cleanup = await this.runRequiredQuestionCleanup()
        if (cleanup.filledCount > 0) {
          const retryNext = this.findBestActionButton("next")
          if (retryNext) await this.clickAndWaitForProgress(retryNext)
        }
      }
    }
    return { submitted: false, reason: "Agent mode reached max step transitions before confirmation." }
  }

  private async runWorkdayAgentLoop(maxTransitions = 10): Promise<AgentLoopResult> {
    if (!this.autofillProfile) {
      return { submitted: false, reason: "No autofill profile found for Workday." }
    }

    for (let i = 0; i < maxTransitions; i += 1) {
      if (this.isConfirmationPage()) return { submitted: true }

      const result = await runWorkdayAutofillInExistingBar({
        profile: this.autofillProfile,
        resumeJobId: this.knownJobId ?? this.analysis?.jobId ?? this.saveResult?.jobId ?? undefined,
        onSnapshot: (snapshot) => {
          this.workdaySnapshot = snapshot
          this.render()
        },
        onWarning: () => {
          // warnings are already reflected in runner state; no-op
        },
        maxCycles: 14,
      })
      this.autofillResults = result.rows

      if (result.phase === "error") {
        return { submitted: false, reason: summarizeWorkdayDebug(result.debugTail) ?? "Workday autofill failed." }
      }
      if (result.blockedReason === "account_required") {
        return {
          submitted: false,
          needsLogin: true,
          reason: "Workday requires account sign-in before autofill can continue.",
        }
      }

      // "Apply Manually" was just clicked — the blank form is loading. Don't
      // hunt for a Save and Continue button (there isn't one yet); let the next
      // iteration re-detect and fill My Information.
      if (result.stepId === "start_application") {
        await sleep(700)
        continue
      }

      if (result.reachedReview) {
        // Stop-at-review: the agent filled every step but does NOT click the
        // final submit. Hand off to the user for a 1-click confirm. The caller
        // raises the Final Review panel, highlights the real Submit button, and
        // parks the run in `waiting_review` until the user submits (which
        // navigates to the confirmation page and advances the run).
        return { submitted: false, reachedReview: true }
      }

      const nextButton = this.findBestActionButton("next")
      if (!nextButton) {
        return { submitted: false, reason: "Workday Save and Continue button not found." }
      }
      await this.clickAndWaitForProgress(nextButton)
    }

    return { submitted: false, reason: "Workday agent mode reached max step transitions before confirmation." }
  }

  /**
   * Fire-and-forget progress signal for the background autonomous run. Harmless
   * when no run is active — the background ignores it unless this tab is the one
   * it is currently driving.
   */
  private sendRunStatus(phase: "waiting_login" | "waiting_review" | "filling" | "failed", reason?: string): void {
    if (!chrome.runtime?.id) return
    chrome.runtime.sendMessage({ type: "AGENT_RUN_STATUS", phase, reason }, () => {
      void chrome.runtime.lastError
    })
  }

  /**
   * Record a submitted application: persist proof, signal the dashboard, and
   * settle the bar into its done state. Used both when the agent reaches a
   * confirmation page itself and when it lands on one after a post-submit login.
   */
  private async finishAsSubmitted(): Promise<{ handled: boolean }> {
    this.agentWaitingForReview = false
    this.clearSubmitHighlight()
    await this.maybeSaveProofAutomatically()
    if (chrome.runtime?.id) {
      chrome.runtime.sendMessage(
        {
          type: "AGENT_APPLICATION_SUBMITTED",
          jobId: this.knownJobId,
          applyUrl: location.href,
          atsProvider: this.site,
        },
        () => {
          // Fire-and-forget signal to the dashboard tab; ignore response errors.
          void chrome.runtime.lastError
        },
      )
    }
    this.autofillStatus = "done"
    this.autofillError = null
    this.render()
    return { handled: true }
  }

  private async runAgentAutofill(payload?: Record<string, unknown>): Promise<{ handled: boolean; waiting?: boolean }> {
    // A run is already in flight — report not-done (waiting) so the caller keeps
    // the agent context and keeps polling, rather than prematurely consuming it
    // mid-run or counting it as a stuck retry.
    if (this.agentModeRunning) return { handled: false, waiting: true }
    this.agentModeRunning = true

    try {
      if (typeof payload?.jobId === "string" && payload.jobId) {
        this.knownJobId = payload.jobId
      }
      if (typeof payload?.coverLetterId === "string" && payload.coverLetterId) {
        this.coverLetterId = payload.coverLetterId
      }

      // Always refresh form/context before automation kicks in.
      this.runDetection()

      // Login / account-creation page — the user needs to sign in first.
      // Show a banner, do NOT mark as error, and return handled:false so the
      // background keeps the pending context and retries on the next page load.
      if (this.isLoginOrAccountPage()) {
        this.agentWaitingForLogin = true
        this.autofillStatus = "idle"
        this.autofillError = null
        this.render()
        this.sendRunStatus("waiting_login")
        return { handled: false, waiting: true }
      }

      // If we were waiting for login and now have a form, clear the banner.
      this.agentWaitingForLogin = false
      // A fresh fill pass is starting — drop any prior review handoff state and
      // its submit-button highlight so they don't linger across pages.
      this.agentWaitingForReview = false
      this.clearSubmitHighlight()
      this.sendRunStatus("filling")

      // Re-triggered onto a confirmation page — typically after the user signed
      // in following a post-submit login prompt. The application is already in;
      // record it instead of trying to autofill a completed page.
      if (this.isConfirmationPage()) {
        return await this.finishAsSubmitted()
      }

      if (!this.autofillSiteSupported()) {
        // We may be on the job posting (e.g. SmartRecruiters), not the form yet.
        // Click the apply CTA ("I'm interested" / "Apply") to reach the form, then
        // let the re-trigger fill it on the next page.
        if (this.tryClickApplyCta()) {
          this.autofillStatus = "idle"
          this.autofillError = null
          this.render()
          this.sendRunStatus("filling")
          // Transitioning toward the form — keep polling (not a stuck retry).
          return { handled: false, waiting: true }
        }
        this.autofillStatus = "error"
        this.autofillError = "No supported application form detected for agent mode."
        this.render()
        // No form and no CTA: this is a genuine dead-end, NOT a login wait.
        // waiting:false → the drivers bound their retries instead of re-running
        // forever (the Ashby "fill loops unending" bug when detection misses).
        return { handled: false, waiting: false }
      }

      // Ensure a tracker record exists for later proof persistence.
      if (!this.knownJobId && this.job) {
        await this.onSave()
      }

      // Load profile once up front so both generic and Workday flows can reuse it.
      const { profile } = await getAutofillProfile()
      this.autofillProfile = profile
      if (!profile) {
        this.autofillStatus = "error"
        this.autofillError = "No saved autofill profile found."
        this.render()
        this.sendRunStatus("failed", this.autofillError)
        return { handled: true }
      }

      this.autofillStatus = "filling"
      this.autofillError = null
      this.render()

      const result =
        this.site === "workday"
          ? await this.runWorkdayAgentLoop(12)
          : await this.runGenericAgentLoop(10)

      if (!result.submitted) {
        // Stop-at-review: every step is filled and we're parked on the final
        // review page. Do NOT submit — raise the review banner, highlight the
        // real submit button, and keep the agent context alive (waiting:true)
        // so the user's submit click navigates to the confirmation page, which
        // re-triggers us and advances the run. The run is parked, not failed.
        if (result.reachedReview) {
          this.agentWaitingForReview = true
          this.autofillStatus = "idle"
          this.autofillError = null
          this.highlightSubmitButton()
          this.render()
          this.sendRunStatus("waiting_review")
          return { handled: false, waiting: true }
        }

        // A mid-flow sign-in requirement (e.g. Workday account_required, or a page
        // that redirected to login between steps) is NOT a failure — pause and keep
        // the pending agent context alive so we re-trigger automatically after the
        // user logs in. Returning handled:false tells the background to retry on the
        // next page load instead of dropping this job.
        this.runDetection()
        if (result.needsLogin || this.isLoginOrAccountPage()) {
          this.agentWaitingForLogin = true
          this.autofillStatus = "idle"
          this.autofillError = null
          this.render()
          this.sendRunStatus("waiting_login")
          return { handled: false, waiting: true }
        }

        this.autofillStatus = "error"
        this.autofillError = result.reason ?? "Agent mode could not submit this application."
        this.render()
        this.sendRunStatus("failed", this.autofillError)
        return { handled: true }
      }

      return await this.finishAsSubmitted()
    } catch (err) {
      this.autofillStatus = "error"
      this.autofillError = err instanceof Error ? err.message : "Agent mode failed unexpectedly."
      this.render()
      this.sendRunStatus("failed", this.autofillError)
      return { handled: true }
    } finally {
      this.agentModeRunning = false
    }
  }

  private persistMinimized(): void {
    try {
      void chrome.storage.local.set({ [MINIMIZED_STORAGE_KEY]: this.minimized })
    } catch {
      // ignore
    }
  }

  // ── Save / Analyze actions ──────────────────────────────────────────────────

  /**
   * Re-extract from the live DOM at action time. The cached `this.job` may be
   * stale on SPAs where React hydrates content after the bar's initial scan
   * (e.g. LinkedIn /jobs/search?currentJobId=... where the side pane renders
   * the job lazily). This catches the freshest DOM so save/analyze submit
   * complete data instead of "Unknown Role" + null company.
   */
  private freshJob(): ExtractedJob | null {
    try {
      const next = extractJob(document, location.href)
      this.job = next
      return next
    } catch {
      return this.job
    }
  }

  private async onSave(): Promise<void> {
    if (this.saveStatus === "loading") return
    const job = this.freshJob()
    if (!job) return
    this.saveStatus = "loading"
    this.saveError = null
    this.render()
    try {
      const result = await saveExtractedJob(job)
      this.saveResult = result
      this.knownJobId = result.jobId
      this.saveStatus = "saved"
    } catch (err) {
      this.saveStatus = "error"
      this.saveError = err instanceof Error ? err.message : "Save failed"
    }
    this.render()
  }

  private async onAnalyze(): Promise<void> {
    if (this.analyzeStatus === "loading") return
    const job = this.freshJob()
    if (!job) return
    this.analyzeStatus = "loading"
    this.analyzeError = null
    this.render()
    try {
      const result = await analyzeExtractedJob(job)
      this.analysis = result
      if (result.jobId) this.knownJobId = result.jobId
      this.analyzeStatus = "done"
      this.analysisOpen = true
    } catch (err) {
      this.analyzeStatus = "error"
      this.analyzeError = err instanceof Error ? err.message : "Analyze failed"
    }
    this.render()
  }

  /**
   * One-click inline tailor. No redirect: resolve a jobId (save if needed),
   * fetch a tailor preview, and immediately approve it as a new resume
   * version. The autofill flow's fetchPrimaryResume({ jobId }) call then
   * picks up the tailored copy automatically.
   *
   * Note: when the user hasn't saved yet, this implicitly creates a tracker
   * entry — same trade-off as before.
   */
  private async onTailor(): Promise<void> {
    if (this.tailorStatus === "loading") return

    const job = this.freshJob()
    if (!job) return

    this.tailorStatus = "loading"
    this.tailorError = null
    this.tailorMatchScore = null
    this.tailoredResumeId = null
    this.tailoredResumeVersionId = null
    this.tailorSnapStatus = "idle"
    this.tailorSnapError = null
    this.render()

    try {
      let jobId = this.knownJobId ?? this.analysis?.jobId ?? this.saveResult?.jobId ?? null
      if (!jobId) {
        const result = await saveExtractedJob(job)
        jobId = result.jobId
        this.saveResult = result
        this.knownJobId = result.jobId
        this.alreadySaved = true
      }

      const detectedAts = this.formDetection?.detectedAts
      const ats =
        detectedAts && detectedAts !== "unknown"
          ? detectedAts
          : TAILORING_ATS_SITES.has(this.site)
            ? this.site
            : undefined

      const preview = await sendBackgroundMessage<TailorPreviewResult>({
        type: "GET_TAILOR_PREVIEW",
        jobId,
        ats,
      })

      if (preview.status === "missing_resume") {
        throw new Error(preview.summary || "No resume on file — upload one in Hireoven first.")
      }
      if (preview.status === "gated") {
        throw new Error(preview.summary || "Tailor is gated for your plan.")
      }
      if (preview.status === "missing_job_context") {
        throw new Error(preview.summary || "Missing job context — try Save first.")
      }

      const approve = await sendBackgroundMessage<TailorApproveResult>({
        type: "APPROVE_TAILORED_RESUME",
        jobId,
        resumeId: preview.resumeId ?? undefined,
        ats,
      })

      if (!approve.success) {
        throw new Error(approve.error || "Could not save tailored resume version.")
      }

      this.tailorStatus = "done"
      this.tailorMatchScore = approve.matchScore ?? preview.matchScore ?? null
      this.tailoredResumeId = approve.resumeId ?? preview.resumeId ?? null
      this.tailoredResumeVersionId = approve.versionId ?? null
      if (this.site === "workday") {
        // Workday apply-flow tenants can crash when resume attachment is pushed
        // before the Experience step creates a stable application context.
        // WorkdayAutofillRunner uploads in My Experience, so mark tailored as
        // ready and skip direct injection here.
        this.tailorSnapStatus = "snapped"
        this.tailorSnapError = null
      } else {
        await this.onSnapTailoredResume()
      }
    } catch (err) {
      this.tailorStatus = "error"
      this.tailorError = err instanceof Error ? err.message : "Tailor failed"
    }
    this.render()
  }

  private async onSnapTailoredResume(): Promise<void> {
    if (this.tailorStatus !== "done") return
    if (this.site === "workday") {
      this.tailorSnapStatus = "snapped"
      this.tailorSnapError = null
      this.render()
      return
    }
    if (!this.tailoredResumeVersionId && !this.tailoredResumeId) {
      this.tailorSnapStatus = "error"
      this.tailorSnapError = "No tailored resume version found."
      this.render()
      return
    }
    if (this.tailorSnapStatus === "snapping") return

    this.tailorSnapStatus = "snapping"
    this.tailorSnapError = null
    this.render()

    const attempts = 8
    const delayMs = 700
    let lastError = "Could not find resume upload field on this step."

    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const result = await sendBackgroundMessage<InjectResumeFileInTabResult>({
          type: "INJECT_RESUME_FILE_IN_TAB",
          versionId: this.tailoredResumeVersionId ?? undefined,
          resumeId: this.tailoredResumeId ?? undefined,
        })
        if (result.injected) {
          this.tailorSnapStatus = "snapped"
          this.tailorSnapError = null
          this.render()
          return
        }
        if (result.error) lastError = result.error
      } catch (err) {
        lastError = err instanceof Error ? err.message : "Could not attach resume."
      }

      if (attempt < attempts) {
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs))
      }
    }

    this.tailorSnapStatus = "error"
    this.tailorSnapError = lastError
    this.render()
  }

  // ── Autofill (ATS + generic form fallback) ─────────────────────────────────

  /** True when this page currently has an autofill-capable application form. */
  private autofillSiteSupported(): boolean {
    const det = this.formDetection
    if (!det || !det.hasForm) return false
    if (this.site === "workday") return true
    return det.supportsAutofill
  }

  /**
   * Step 1: fetch the user's profile and detect safe fields on the page.
   * Renders a preview panel; the user must explicitly click "Confirm fill"
   * before any DOM mutation. We never auto-fill in the background.
   */
  private async onAutofillPreview(): Promise<void> {
    if (this.autofillStatus === "loading" || this.autofillStatus === "filling") return
    if (!this.autofillSiteSupported()) return
    const source = this.toAutofillSource()

    this.autofillStatus = "loading"
    this.autofillError = null
    this.workdaySnapshot = null
    this.render()

    try {
      const { profile, profileMissing } = await getAutofillProfile()
      this.autofillProfile = profile

      if (this.site === "workday") {
        const ready = Boolean(profile) && isWorkdayApplicationPage()
        if (!ready) {
          this.autofillPreview = [
            {
              label: "Workday multi-step autofill",
              valuePreview: "Workday application container not detected on this page.",
              confidence: "needs_review",
              source: profile ? "profile" : "manual_required",
              filled: false,
              skippedReason: profileMissing || !profile
                ? "No saved autofill profile."
                : "Open an active Workday application step first.",
            },
          ]
          this.autofillStatus = "preview"
          void this.logAutofillTelemetry({
            stage: "preview",
            fieldsFilled: 0,
            fieldsTotal: 1,
            manualReviewCount: 1,
            errorMessage: profileMissing || !profile ? "profile_missing" : "workday_step_not_detected",
          })
          this.render()
          return
        }

        // Multi-step runner — preview can't enumerate every field up front, so
        // surface a per-section estimate so the user sees roughly how much will
        // happen when they click Confirm. Values come from the profile shape.
        const est = estimateWorkdayAutofillFields(profile!)
        const sections: Array<[string, number]> = (
          [
            ["My Information", est.myInformation],
            ["My Experience", est.experience],
            ["Education", est.education],
            ["Skills", est.skills],
            ["Websites", est.websites],
            ["Application Questions", est.questions],
          ] as Array<[string, number]>
        ).filter(([, count]) => count > 0)

        this.autofillPreview = [
          {
            label: `Workday autofill · ≈${est.total} fields across ${sections.length} sections`,
            valuePreview: "Resume upload → My Information → Experience → Questions",
            confidence: "high",
            source: "profile",
            filled: false,
          },
          ...sections.map<AutofillFieldResult>(([name, count]) => ({
            label: name,
            valuePreview: `≈${count} field${count === 1 ? "" : "s"}`,
            confidence: "high",
            source: "profile",
            filled: false,
          })),
          {
            label: "Self-Identify (EEO)",
            valuePreview: "Paused — you complete this manually",
            confidence: "needs_review",
            source: "manual_required",
            filled: false,
            skippedReason: "Apex never fills voluntary legal disclosures.",
          },
          {
            label: "Review & Submit",
            valuePreview: "Paused — review then click Submit yourself",
            confidence: "needs_review",
            source: "manual_required",
            filled: false,
            skippedReason: "Apex never auto-submits.",
          },
        ]
        this.autofillStatus = "preview"
        void this.logAutofillTelemetry({
          stage: "preview",
          fieldsFilled: 0,
          fieldsTotal: est.total,
          manualReviewCount: 0,
        })
        this.render()
        return
      }

      if (profileMissing || !profile) {
        // Still build a preview so the user sees which fields would be filled
        // — they'll appear with skippedReason "No saved autofill profile."
        this.autofillPreview = buildAutofillPreview(
          source,
          null,
          document,
        )
      } else {
        this.autofillPreview = buildAutofillPreview(
          source,
          profile,
          document,
        )
      }

      this.autofillStatus = "preview"
      const previewSummary = this.summarizeAutofillRows(this.autofillPreview)
      void this.logAutofillTelemetry({
        stage: "preview",
        fieldsFilled: 0,
        fieldsTotal: previewSummary.fillableCount,
        manualReviewCount: previewSummary.manualReviewCount,
      })
    } catch (err) {
      this.autofillStatus = "error"
      this.autofillError = err instanceof Error ? err.message : "Autofill preview failed"
      void this.logAutofillTelemetry({
        stage: "error",
        fieldsFilled: 0,
        fieldsTotal: 1,
        manualReviewCount: 0,
        errorMessage: this.autofillError,
      })
    }
    this.render()
  }

  /**
   * Step 2: commit the preview to the DOM. Only fields with `valuePreview`
   * (i.e. resolvable from the profile) are filled. Sensitive / file-upload /
   * unknown fields stay marked with skippedReason.
   *
   * Resume file inputs are attached via DataTransfer (same pattern as
   * JobRight / FrogHire). Cover letter inputs remain "Needs user action".
   */
  private async onAutofillConfirm(): Promise<void> {
    if (this.autofillStatus !== "preview") return
    if (!this.autofillProfile) {
      this.autofillStatus = "error"
      this.autofillError = "No profile to fill from."
      this.render()
      return
    }
    if (!this.autofillSiteSupported()) return

    this.autofillStatus = "filling"
    const previewSummary = this.summarizeAutofillRows(this.autofillPreview)
    void this.logAutofillTelemetry({
      stage: "attempt",
      fieldsFilled: 0,
      fieldsTotal: Math.max(previewSummary.fillableCount, 1),
      manualReviewCount: previewSummary.manualReviewCount,
    })
    this.render()

    try {
      if (this.site === "workday") {
        const runOptions = {
          profile: this.autofillProfile,
          resumeJobId: this.knownJobId ?? this.analysis?.jobId ?? this.saveResult?.jobId ?? undefined,
          onSnapshot: (snapshot) => {
            this.workdaySnapshot = snapshot
            this.autofillPreview = [
              {
                label: `Workday Step ${snapshot.step.index} of ${snapshot.step.total} · ${snapshot.step.name}`,
                valuePreview: `${snapshot.fieldsFilledCount}/${snapshot.totalExpectedFields} · ${snapshot.progressPct}%`,
                confidence: "high",
                source: "profile",
                filled: false,
                skippedReason: undefined,
              },
            ]
            this.render()
          },
          onWarning: (line) => {
            const note = line.replace(/^⚠️\s*/u, "")
            const existing = this.autofillPreview ?? []
            const has = existing.some((row) => row.label === note && row.skippedReason)
            if (!has) {
              existing.push({
                label: note,
                confidence: "needs_review",
                source: "manual_required",
                filled: false,
                skippedReason: line,
              })
              this.autofillPreview = existing
            }
          },
          maxCycles: 14,
        } satisfies Parameters<typeof runWorkdayAutofillInExistingBar>[0]

        let result = await runWorkdayAutofillInExistingBar(runOptions)
        let fallbackUsed = false
        let fallbackFilledCount = 0
        let fallbackFillableCount = 0
        let fallbackManualReviewCount = 0
        let autoAdvancedResumeStep = false
        if (
          result.stepId === "resume_upload" &&
          result.phase !== "error" &&
          result.fieldsFilledCount > 0 &&
          result.manualReviewCount === 0 &&
          !result.blockedReason
        ) {
          const nextButton = this.findBestActionButton("next")
          if (nextButton) {
            const progressed = await this.clickAndWaitForProgress(nextButton)
            if (progressed) {
              autoAdvancedResumeStep = true
              result = await runWorkdayAutofillInExistingBar(runOptions)
            }
          }
        }

        // Fallback: when Workday's step-aware automation hits tenant-specific
        // DOM/API breakage, try the generic safe-field fill on the same step so
        // contact/location fields still get populated.
        if (
          result.phase === "error" ||
          (
            result.fieldsFilledCount === 0 &&
            !result.blockedReason &&
            !result.eeoPaused &&
            !result.reachedReview
          )
        ) {
          try {
            const fallback = await this.tryWorkdayGenericFallback()
            if (fallback && fallback.filledCount > 0) {
              fallbackUsed = true
              fallbackFilledCount = fallback.filledCount
              fallbackFillableCount = fallback.fillableCount
              fallbackManualReviewCount = fallback.manualReviewCount
              this.autofillResults = fallback.rows
            }
          } catch {
            // best-effort fallback only
          }
        }

        if (!fallbackUsed) {
          this.autofillResults = result.rows
        }
        const hint = summarizeWorkdayDebug(result.debugTail)
        const filledMsg = `${result.fieldsFilledCount} fields filled on this step.`
        const nextStepHint = "Review, fix anything needed, then click Save and Continue on the page. I'll re-arm Autofill when the next step loads."

        if (result.phase === "error" && !fallbackUsed) {
          this.autofillStatus = "error"
          this.autofillError = hint
            ? `Workday autofill stopped: ${hint}`
            : "Workday autofill could not complete. In DevTools Console run: window.__hoWorkdayAutofillDebug?.slice(-120)"
        } else if (fallbackUsed && result.phase === "error") {
          this.autofillStatus = "done"
          this.autofillError =
            `Workday fallback filled ${fallbackFilledCount}/${Math.max(fallbackFillableCount, 1)} basic fields. Review and continue manually.`
        } else if (result.blockedReason === "account_required") {
          this.autofillStatus = "done"
          this.autofillError =
            "Workday requires Sign In or Create Account before autofill can continue. Complete that step, then click Autofill again."
        } else if (result.eeoPaused) {
          this.autofillStatus = "done"
          this.autofillError = "Self-Identify step reached. Complete manually, then click Save and Continue."
        } else if (result.reachedReview) {
          this.autofillStatus = "done"
          this.autofillError = "Review step reached. Verify everything and submit yourself — Apex will not auto-submit."
        } else if (result.manualReviewCount > 0) {
          // Step partially filled — some required fields still need the user.
          this.autofillStatus = "done"
          this.autofillError = `${filledMsg} ${result.manualReviewCount} field${result.manualReviewCount === 1 ? "" : "s"} still need you${hint ? ` (${hint})` : ""}. Fix and click Save and Continue.`
        } else if (result.fieldsFilledCount === 0) {
          // Workday question pages frequently contain tenant-specific policy
          // prompts where Apex cannot infer safe defaults. That's a review
          // outcome, not a hard runtime failure.
          this.autofillStatus = "done"
          const questionStep = result.stepId === "application_questions"
          this.autofillError = questionStep
            ? "No safe auto-answers were applied on this questionnaire step. Answer the Select One fields manually, then click Save and Continue."
            : hint
              ? `No fields were changed on this step — ${hint}. Review and continue manually.`
              : "No fields were changed on this step. Review and continue manually."
        } else {
          this.autofillStatus = "done"
          this.autofillError = autoAdvancedResumeStep
            ? `${filledMsg} Step 1 resume upload was completed and advanced automatically. ${nextStepHint}`
            : `${filledMsg} ${nextStepHint}`
        }
        const effectiveFieldsFilled = fallbackUsed
          ? Math.max(result.fieldsFilledCount, fallbackFilledCount)
          : result.fieldsFilledCount
        const effectiveFieldsTotal = Math.max(
          1,
          result.totalExpectedFields,
          fallbackFillableCount,
        )
        const effectiveManualReview = Math.max(
          result.manualReviewCount,
          fallbackManualReviewCount,
        )
        const stage: "success" | "partial" | "error" =
          this.autofillStatus === "error"
            ? "error"
            : (
              result.blockedReason ||
              result.eeoPaused ||
              result.reachedReview ||
              effectiveManualReview > 0 ||
              effectiveFieldsFilled === 0 ||
              fallbackUsed
            )
              ? "partial"
              : "success"
        void this.logAutofillTelemetry({
          stage,
          fieldsFilled: effectiveFieldsFilled,
          fieldsTotal: effectiveFieldsTotal,
          manualReviewCount: effectiveManualReview,
          errorMessage: this.autofillStatus === "error" ? this.autofillError ?? undefined : undefined,
          fallbackUsed,
        })
        this.render()
        return
      }

      // Only fetch the resume if the page actually has a resume_upload field
      // and we have something to attach. Saves a roundtrip on forms with no
      // file inputs.
      const needsResume = (this.autofillPreview ?? []).some(
        (f) => f.source === "resume" && !f.skippedReason,
      )
      let resumeBytes: { base64: string; filename: string } | null = null
      const shouldFetchResume = needsResume || this.site === "ashby"
      if (shouldFetchResume) {
        try {
          // knownJobId is the authoritative jobId for this page — set by /check
          // (always when the job exists in the DB), /save (on fresh save), or
          // /analyze. With it the server returns the per-job tailored copy when
          // one exists; without it, primary resume is the fallback.
          resumeBytes = await fetchPrimaryResume({
            versionId: this.tailoredResumeVersionId ?? undefined,
            resumeId: this.tailoredResumeId ?? undefined,
            jobId: this.currentAutofillJobId(),
          })
        } catch {
          // Leave resumeBytes null — applySafeFills will mark the field as
          // "No resume on file — upload one in Hireoven first."
        }
      }

      // Direct fill — we do NOT use Ashby's "Autofill from resume" parser.
      // applySafeFills fills name/email/phone/LinkedIn text and attaches the
      // résumé to the real required Resume field; fillAshbyComboboxes selects the
      // Location typeahead; runRequiredQuestionCleanup answers the yes/no, radio
      // and consent-checkbox questions.
      this.autofillResults = await applySafeFills(
        this.toAutofillSource(),
        this.autofillProfile,
        resumeBytes,
        document,
      )
      if (this.site === "ashby") {
        try {
          await fillAshbyComboboxes(this.autofillProfile, document)
        } catch {
          // best-effort — typeahead selection is non-fatal
        }
      }
      await this.runRequiredQuestionCleanup()
      this.autofillStatus = "done"
      const resultSummary = this.summarizeAutofillRows(this.autofillResults)
      if (resultSummary.fillableCount > 0 && resultSummary.filledCount === 0) {
        this.autofillError = "No fields were changed. Review the form and fill required fields manually."
      } else {
        this.autofillError = null
      }
      const genericStage: "success" | "partial" | "error" =
        resultSummary.fillableCount > 0 && resultSummary.filledCount === 0
          ? "error"
          : resultSummary.manualReviewCount > 0 || resultSummary.filledCount < resultSummary.fillableCount
            ? "partial"
            : "success"
      void this.logAutofillTelemetry({
        stage: genericStage,
        fieldsFilled: resultSummary.filledCount,
        fieldsTotal: Math.max(resultSummary.fillableCount, 1),
        manualReviewCount: resultSummary.manualReviewCount,
        errorMessage: genericStage === "error" ? this.autofillError ?? undefined : undefined,
      })

      // If the form has a cover-letter slot, capture its selector and kick off
      // generation in the background. The user reviews + clicks Attach later.
      const coverRow = (this.autofillResults ?? []).find((r) => r.source === "cover_letter")
      if (coverRow?.selector) {
        this.coverLetterSelector = coverRow.selector
        if (this.coverLetterStatus === "idle" && !this.coverLetterBody) {
          void this.onGenerateCoverLetter()
        }
      }
    } catch (err) {
      this.autofillStatus = "error"
      const base = err instanceof Error ? err.message : "Fill failed"
      this.autofillError = this.site === "workday"
        ? `${base}. In DevTools Console run: window.__hoWorkdayAutofillDebug?.slice(-120)`
        : base
      void this.logAutofillTelemetry({
        stage: "error",
        fieldsFilled: 0,
        fieldsTotal: Math.max(previewSummary.fillableCount, 1),
        manualReviewCount: previewSummary.manualReviewCount,
        errorMessage: this.autofillError,
      })
    }
    this.render()
  }

  /** Cancel preview → return to idle without filling anything. */
  private onAutofillCancel(): void {
    this.autofillStatus = "idle"
    this.autofillPreview = null
    this.autofillResults = null
    this.autofillError = null
    this.workdaySnapshot = null
    this.aiAnswers.clear()
    this.render()
  }

  // ── AI Answer flow ────────────────────────────────────────────────────────

  private async onAiAnswer(selector: string, label: string): Promise<void> {
    if (this.aiAnswers.get(selector)?.status === "loading") return
    this.aiAnswers.set(selector, { status: "loading" })
    this.render()

    const job = this.job
    try {
      const result = await answerQuestion({
        question: label,
        jobTitle: job?.title ?? undefined,
        company: job?.company ?? undefined,
      })
      this.aiAnswers.set(selector, { status: "done", answer: result.answer })
    } catch (err) {
      this.aiAnswers.set(selector, {
        status: "error",
        error: err instanceof Error ? err.message : "Failed to generate answer.",
      })
    }
    this.render()
  }

  private onAiFill(selector: string, answer: string): void {
    try {
      const el = document.querySelector<HTMLElement>(selector)
      if (!el) return
      setReactValue(el, answer)
      // Mark as done in the preview list so the row flips to "Filled"
      const list = this.autofillPreview ?? this.autofillResults
      if (list) {
        const row = list.find((f) => f.selector === selector)
        if (row) {
          row.valuePreview = answer
          row.skippedReason = undefined
          row.source = "resume"
          row.filled = true
        }
      }
      this.aiAnswers.delete(selector)
      this.render()
    } catch {
      // silently fail — field may have navigated away
    }
  }

  // ── Cover letter review flow ───────────────────────────────────────────────

  /**
   * Generate (or regenerate) a cover letter for the saved job. Requires a
   * jobId — if the job hasn't been saved yet, we save it implicitly via the
   * existing onSave path so the user gets a single-click experience.
   */
  private async onGenerateCoverLetter(opts?: { regenerate?: boolean }): Promise<void> {
    if (this.coverLetterStatus === "generating") return

    let jobId =
      this.knownJobId ??
      this.analysis?.jobId ??
      this.saveResult?.jobId ??
      null

    // If we don't have a jobId yet, save the job first so the server has
    // something to attach the cover letter to.
    if (!jobId) {
      try {
        await this.onSave()
        jobId = this.knownJobId ?? this.saveResult?.jobId ?? null
      } catch {
        // fall through — error surfaced below
      }
    }
    if (!jobId) {
      this.coverLetterStatus = "error"
      this.coverLetterError = "Save the job first to generate a cover letter."
      this.render()
      return
    }

    this.coverLetterStatus = "generating"
    this.coverLetterError = null
    if (opts?.regenerate) {
      this.coverLetterBody = null
      this.coverLetterId = null
      this.coverLetterDirty = false
    }
    this.render()

    try {
      const ats = this.site === "greenhouse" || this.site === "lever" ? this.site : undefined
      const res = await generateCoverLetter({ jobId, ats, regenerate: opts?.regenerate })
      this.coverLetterId = res.coverLetterId
      this.coverLetterBody = res.coverLetter
      this.coverLetterDirty = false
      this.coverLetterStatus = "ready"
    } catch (err) {
      this.coverLetterStatus = "error"
      this.coverLetterError = err instanceof Error ? err.message : "Generation failed"
    }
    this.render()
  }

  /** Persist user edits to the generated draft. */
  private async onSaveCoverLetterEdits(): Promise<void> {
    if (!this.coverLetterId || !this.coverLetterBody || !this.coverLetterDirty) return
    if (this.coverLetterStatus === "saving") return
    this.coverLetterStatus = "saving"
    this.render()
    try {
      await updateCoverLetter({ id: this.coverLetterId, body: this.coverLetterBody })
      this.coverLetterDirty = false
      this.coverLetterStatus = "ready"
    } catch (err) {
      this.coverLetterStatus = "error"
      this.coverLetterError = err instanceof Error ? err.message : "Save failed"
    }
    this.render()
  }

  /**
   * Fetch the latest persisted DOCX and attach it to the detected file input
   * via the same DataTransfer pattern used for the resume.
   */
  private async onAttachCoverLetter(): Promise<void> {
    if (!this.coverLetterId || !this.coverLetterSelector) return
    if (this.coverLetterStatus === "attaching") return

    // If the user has unsaved edits, persist them first so the DOCX matches
    // what they see in the textarea.
    if (this.coverLetterDirty) {
      await this.onSaveCoverLetterEdits()
      if (this.coverLetterStatus === "error") return
    }

    this.coverLetterStatus = "attaching"
    this.coverLetterError = null
    this.render()

    try {
      const bytes = await fetchCoverLetterDocx({ coverLetterId: this.coverLetterId })
      const target = document.querySelector<HTMLInputElement>(this.coverLetterSelector)
      if (!target) {
        this.coverLetterStatus = "error"
        this.coverLetterError = "Cover letter field disappeared from page."
        this.render()
        return
      }
      const ok = injectDocxFile(target, bytes)
      if (!ok) {
        this.coverLetterStatus = "error"
        this.coverLetterError = "Could not attach — attach it manually."
        this.render()
        return
      }
      // Mark the row in the autofill results as filled so the UI reflects it.
      if (this.autofillResults) {
        this.autofillResults = this.autofillResults.map((r) =>
          r.source === "cover_letter" ? { ...r, filled: true } : r,
        )
      }
      this.coverLetterStatus = "attached"
      // Best-effort: mark the row as used so analytics / dashboard reflect it.
      void updateCoverLetter({ id: this.coverLetterId, was_used: true }).catch(() => undefined)
    } catch (err) {
      this.coverLetterStatus = "error"
      this.coverLetterError = err instanceof Error ? err.message : "Attach failed"
    }
    this.render()
  }

  /**
   * Re-render only the cover letter action bar (without nuking the textarea
   * the user is typing into). Falls back to a full render if the surface
   * isn't mounted yet.
   */
  private refreshCoverLetterActions(): void {
    if (!this.root) return this.render()
    const slot = this.root.querySelector<HTMLElement>("[data-cl-actions]")
    if (!slot) return
    slot.innerHTML = this.renderCoverLetterActionButtons()
  }

  // ── Confirmation polling + proof flow ──────────────────────────────────────

  /**
   * Some ATSes swap the form for a confirmation message in-place (no URL
   * change, no full reload). Poll for ~30s after detection so the bar can
   * still notice the success page. Stops automatically once detected or on
   * teardown.
   */
  private startConfirmationPolling(): void {
    this.stopConfirmationPolling()
    let ticks = 0
    this.confirmationTimer = setInterval(() => {
      ticks += 1
      // Cap at ~30s — well past any reasonable async-submit ceremony.
      if (ticks > 30) {
        this.stopConfirmationPolling()
        return
      }
      try {
        const next = detectConfirmation(document)
        const wasConfirmed = this.confirmation?.isConfirmation === true
        const nowConfirmed = next.isConfirmation && next.confidence !== "low"
        if (nowConfirmed && !wasConfirmed) {
          this.confirmation = next
          // Auto-fire silent save; pipeline tracker reflects "applied" status
          // without any toast or click.
          if (!this.autoProofFired) {
            this.autoProofFired = true
            void this.onSaveProof()
          }
          this.render()
          this.stopConfirmationPolling()
        }
      } catch {
        // ignore — detection should never throw, but defensive
      }
    }, 1000)
  }

  private stopConfirmationPolling(): void {
    if (this.confirmationTimer) {
      clearInterval(this.confirmationTimer)
      this.confirmationTimer = null
    }
  }

  /**
   * POST /api/extension/applications/proof — explicit user action only.
   * Never called automatically; the bar waits for the user to click the
   * "Save proof" button rendered by renderProofPrompt().
   */
  private async onSaveProof(): Promise<void> {
    if (this.proofStatus === "saving" || this.proofStatus === "saved") return
    if (!this.confirmation?.isConfirmation) return

    this.proofStatus = "saving"
    this.render()

    const jobId =
      this.knownJobId ??
      this.analysis?.jobId ??
      this.saveResult?.jobId ??
      undefined

    try {
      await saveApplicationProof({
        jobId,
        jobUrl: this.job?.url ?? location.href,
        applyUrl: this.job?.applyUrl ?? undefined,
        ats: this.confirmation.ats !== "unknown" ? this.confirmation.ats : (this.site ?? undefined),
        submittedAt: new Date().toISOString(),
        confirmationText: this.confirmation.confirmationText,
        coverLetterId: this.coverLetterId ?? undefined,
      })
      this.proofStatus = "saved"
    } catch (err) {
      this.proofStatus = "error"
      // No UI surfaces this; log so dev tools can still surface real
      // failures during the silent auto-save flow.
      console.warn("[apex-bar] application proof auto-save failed:", err)
    }
    this.render()
  }

  private onDismissProofPrompt(): void {
    // Toast is no longer rendered — auto-save fires silently on detection.
    // Method preserved so the dispatcher's "dismiss-proof" branch stays
    // wired without breaking the action enum.
  }
}
