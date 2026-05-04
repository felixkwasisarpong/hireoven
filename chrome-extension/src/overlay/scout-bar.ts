/**
 * Hireoven Scout Bar — MVP UI shell.
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
  shouldShowAutofillFeatures,
  type ExtensionPageMode,
} from "../detectors/page-mode"
import { extractJob, type ExtractedJob } from "../extractors/scout-extractor"
import {
  analyzeExtractedJob,
  checkExtractedJob,
  fetchCoverLetterDocx,
  fetchPrimaryResume,
  generateCoverLetter,
  getAutofillProfile,
  saveApplicationProof,
  saveExtractedJob,
  updateCoverLetter,
} from "../api-client"
import type { ExtensionJobAnalysis, ExtensionSaveResult } from "../api-types"
import {
  applySafeFills,
  buildAutofillPreview,
  injectDocxFile,
  type AutofillFieldResult,
  type SafeProfile,
} from "../autofill/safe-fields"

// ── Public types ──────────────────────────────────────────────────────────────

export type ScoutBarState = "detecting" | "not_job_page" | "ready" | "error"

// ── Constants ─────────────────────────────────────────────────────────────────

const HOST_ID = "hireoven-scout-bar"
const MINIMIZED_STORAGE_KEY = "hireovenScoutBarMinimized"
const URL_POLL_INTERVAL_MS = 600

const STATUS_TEXT: Record<ScoutBarState, string> = {
  detecting:    "Detecting job page…",
  ready:        "Job page detected",
  not_job_page: "Not a supported job page",
  error:        "Extraction failed",
}

// ── Styles (inlined; no external resources) ───────────────────────────────────

const STYLES = `
  :host { all: initial; }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  .scout-bar {
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
`

// ── Utility ───────────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;"
  )
}

// ── Implementation ────────────────────────────────────────────────────────────

export class ScoutBar {
  private host: HTMLDivElement | null = null
  private shadow: ShadowRoot | null = null
  private root: HTMLDivElement | null = null
  private state: ScoutBarState = "detecting"
  private site: SupportedSite = "unknown"
  private job: ExtractedJob | null = null
  private debugOpen = false
  private minimized = false
  private mounted = false
  private urlTimer: ReturnType<typeof setInterval> | null = null
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

  // Tailor Resume button state. Tailor is a handoff to the Hireoven web app
  // (we don't tailor inside the extension). On click, ensures a jobId exists
  // (saves the job first when needed) then opens /dashboard/resume/tailor.
  private tailorStatus: "idle" | "loading" | "error" = "idle"
  private tailorError: string | null = null

  // Autofill MVP state — Greenhouse + Lever only.
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
  // pages and shows "Application submitted — save proof?". Only on explicit
  // click do we POST to /api/extension/applications/proof.
  private confirmation: ConfirmationDetection | null = null
  private proofStatus: "idle" | "saving" | "saved" | "error" = "idle"
  private proofError: string | null = null
  private proofPromptDismissed: boolean = false
  private confirmationTimer: ReturnType<typeof setInterval> | null = null

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

    // Restore the user's minimized preference.
    try {
      const stored = await chrome.storage.local.get(MINIMIZED_STORAGE_KEY)
      this.minimized = Boolean(stored[MINIMIZED_STORAGE_KEY])
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
    this.autofillStatus = "idle"
    this.autofillPreview = null
    this.autofillResults = null
    this.autofillError = null
    this.autofillProfile = null
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
    this.proofError = null
    this.proofPromptDismissed = false

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

    this.bindEvents()
  }

  private tearDownSurface(): void {
    this.host?.remove()
    this.host = null
    this.shadow = null
    this.root = null
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
        <button class="restore" data-action="restore" aria-label="Show Hireoven Scout" title="Show Hireoven Scout">
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
      <div class="scout-bar" role="region" aria-label="Hireoven Scout">
        <div class="brand">
          <span class="dot ${this.state}"></span>
          <span class="brand-text">Hireoven Scout</span>
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
      return `<button class="action" data-action="tailor" disabled>Opening…</button>`
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
    if (!shouldShowAutofillFeatures(this.pageMode) && this.formDetection?.hasForm !== true) {
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
      this.formDetection?.hasForm !== true
    ) {
      return ""
    }
    const det = this.formDetection
    const hasForm = det?.hasForm === true
    const supports = det?.supportsAutofill === true

    // Form-only ATSes (Workday/Ashby/etc.) — let the user see what we detected
    // even though we can't safely fill. The button toggles a read-only panel.
    if (this.autofillSiteSupported() === false || !supports) {
      if (!hasForm) {
        return `<button class="action" data-action="autofill" disabled title="No application form detected on this page.">Autofill</button>`
      }
      const open = this.detectionPanelOpen
      const label = open ? "Hide detected fields" : "View detected fields"
      const tooltip = !this.autofillSiteSupported()
        ? "Autofill supports Greenhouse and Lever only in this MVP."
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
      return `<button class="action saved" data-action="autofill">✓ Filled</button>`
    }
    if (this.autofillStatus === "error") {
      return `<button class="action error" data-action="autofill" title="${escapeHtml(this.autofillError ?? "Try again")}">Retry autofill</button>`
    }
    return `<button class="action" data-action="autofill">Autofill</button>`
  }

  // ── Proof prompt (post-submission capture) ──────────────────────────────────

  /**
   * Floating prompt rendered above the bar when a confirmation page is
   * detected. Strict opt-in — nothing is sent until the user clicks Save
   * proof. The prompt is dismissible per page load (proofPromptDismissed).
   */
  private renderProofPrompt(): string {
    const conf = this.confirmation
    if (!conf || !conf.isConfirmation) return ""
    if (conf.confidence === "low") return ""
    if (this.proofPromptDismissed) return ""

    const status = this.proofStatus
    if (status === "saved") {
      return `
        <div class="proof-prompt proof-prompt-saved" role="status" aria-live="polite">
          <div class="proof-prompt-body">
            <span class="proof-icon">✓</span>
            <div>
              <div class="proof-title">Application proof saved</div>
              <div class="proof-sub">Tracked in your Hireoven pipeline.</div>
            </div>
          </div>
          <button class="proof-dismiss" data-action="dismiss-proof" aria-label="Dismiss">×</button>
        </div>
      `
    }

    const subtitle = (() => {
      if (status === "saving") return "Saving proof…"
      if (status === "error")  return this.proofError ?? "Save failed — try again."
      const trimmed = conf.confirmationText
        ? conf.confirmationText.length > 90
          ? conf.confirmationText.slice(0, 90) + "…"
          : conf.confirmationText
        : "We detected a successful submission."
      return trimmed
    })()

    const actionLabel =
      status === "saving" ? "Saving…" :
      status === "error"  ? "Retry"  :
                            "Save proof"

    return `
      <div class="proof-prompt ${status === "error" ? "proof-prompt-error" : ""}" role="dialog" aria-label="Application submitted">
        <div class="proof-prompt-body">
          <span class="proof-icon">✓</span>
          <div>
            <div class="proof-title">Application submitted — save proof?</div>
            <div class="proof-sub">${escapeHtml(subtitle)}</div>
          </div>
        </div>
        <div class="proof-actions">
          <button class="proof-btn proof-btn-primary"
                  data-action="save-proof"
                  ${status === "saving" ? "disabled" : ""}>${actionLabel}</button>
          <button class="proof-dismiss" data-action="dismiss-proof" aria-label="Dismiss">×</button>
        </div>
      </div>
    `
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

    const headerSummary = isDone
      ? `${filledCount} filled · ${skippedCount} need review`
      : `${willFill} ready to fill · ${reviewCount} need review`

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

    return `
      <div class="af-row ${statusClass}">
        <div class="af-row-main">
          <div class="af-row-label">${escapeHtml(f.label)}</div>
          <div class="af-row-value">
            ${f.valuePreview ? escapeHtml(f.valuePreview) : `<em>${escapeHtml(f.skippedReason ?? "—")}</em>`}
          </div>
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
    // saves implicitly when needed and opens the web app's tailor flow.
    const tailorBtn = (() => {
      if (this.tailorStatus === "loading") {
        return `<button class="ap-action" disabled>Opening…</button>`
      }
      if (this.tailorStatus === "error") {
        return `<button class="ap-action ap-action-saved" data-action="tailor" title="${escapeHtml(this.tailorError ?? "Try again")}">Retry tailor</button>`
      }
      return `<button class="ap-action" data-action="tailor">Tailor Resume</button>`
    })()

    // Panel's Autofill button mirrors the bar's behavior — Greenhouse + Lever
    // only in the MVP. Click triggers the preview flow regardless of where
    // the click came from (bar or panel).
    const autofillBtn = (() => {
      if (!this.autofillSiteSupported()) {
        return `<button class="ap-action" data-action="autofill" disabled title="Autofill supports Greenhouse and Lever only in this MVP.">Autofill</button>`
      }
      if (this.autofillStatus === "loading" || this.autofillStatus === "filling") {
        return `<button class="ap-action" disabled>${this.autofillStatus === "loading" ? "Detecting…" : "Filling…"}</button>`
      }
      if (this.autofillStatus === "done") {
        return `<button class="ap-action ap-action-saved" data-action="autofill">✓ Filled</button>`
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
   * Tailor Resume handoff. We don't tailor inside the extension — the user
   * approves changes in the existing web-app flow. Steps:
   *   1. Resolve a jobId. Use existing one (analysis.jobId / saveResult.jobId)
   *      if present; otherwise call /save which is idempotent and returns one.
   *   2. Build the Hireoven dashboard URL from whichever response carried it.
   *   3. Open /dashboard/resume/tailor?jobId=...&autoAnalyze=1 in a new tab.
   *
   * Note: when the user hasn't saved yet, this implicitly creates a tracker
   * entry. That's intentional — keeps the flow one-click and the job ends up
   * accessible in their Applications list. They can archive if undesired.
   */
  private async onTailor(): Promise<void> {
    if (this.tailorStatus === "loading") return

    const job = this.freshJob()
    if (!job) return

    this.tailorStatus = "loading"
    this.tailorError = null
    this.render()

    try {
      // Resolve jobId — prefer cached responses, fall back to a save call.
      let jobId = this.knownJobId ?? this.analysis?.jobId ?? this.saveResult?.jobId ?? null
      let dashboardUrl = this.saveResult?.dashboardUrl ?? this.existingDashboardUrl ?? null

      if (!jobId) {
        const result = await saveExtractedJob(job)
        jobId = result.jobId
        dashboardUrl = result.dashboardUrl ?? dashboardUrl
        // Reflect the save in local state so the bar's Save button hides.
        this.saveResult = result
        this.knownJobId = result.jobId
        this.alreadySaved = true
      }

      // Derive the dashboard origin from any URL we have. This is needed
      // because the bar doesn't otherwise know whether the app is on
      // localhost vs hireoven.com.
      let origin: string | null = null
      if (dashboardUrl) {
        try { origin = new URL(dashboardUrl).origin } catch { /* fall through */ }
      }
      if (!origin) {
        throw new Error("Could not resolve Hireoven origin — try saving first.")
      }

      const tailorUrl =
        `${origin}/dashboard/resume/tailor` +
        `?jobId=${encodeURIComponent(jobId)}` +
        `&autoAnalyze=1`

      window.open(tailorUrl, "_blank", "noopener")
      this.tailorStatus = "idle" // open is a one-shot — return to idle
    } catch (err) {
      this.tailorStatus = "error"
      this.tailorError = err instanceof Error ? err.message : "Tailor failed"
    }
    this.render()
  }

  // ── Autofill MVP (Greenhouse + Lever only) ─────────────────────────────────

  /** True when the current site supports the autofill MVP. */
  private autofillSiteSupported(): boolean {
    return this.site === "greenhouse" || this.site === "lever"
  }

  /**
   * Step 1: fetch the user's profile and detect safe fields on the page.
   * Renders a preview panel; the user must explicitly click "Confirm fill"
   * before any DOM mutation. We never auto-fill in the background.
   */
  private async onAutofillPreview(): Promise<void> {
    if (this.autofillStatus === "loading" || this.autofillStatus === "filling") return
    if (!this.autofillSiteSupported()) return

    this.autofillStatus = "loading"
    this.autofillError = null
    this.render()

    try {
      const { profile, profileMissing } = await getAutofillProfile()
      this.autofillProfile = profile

      if (profileMissing || !profile) {
        // Still build a preview so the user sees which fields would be filled
        // — they'll appear with skippedReason "No saved autofill profile."
        this.autofillPreview = buildAutofillPreview(
          this.site as "greenhouse" | "lever",
          null,
          document,
        )
      } else {
        this.autofillPreview = buildAutofillPreview(
          this.site as "greenhouse" | "lever",
          profile,
          document,
        )
      }

      this.autofillStatus = "preview"
    } catch (err) {
      this.autofillStatus = "error"
      this.autofillError = err instanceof Error ? err.message : "Autofill preview failed"
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
    this.render()

    try {
      // Only fetch the resume if the page actually has a resume_upload field
      // and we have something to attach. Saves a roundtrip on forms with no
      // file inputs.
      const needsResume = (this.autofillPreview ?? []).some(
        (f) => f.source === "resume" && !f.skippedReason,
      )
      let resumeBytes: { base64: string; filename: string } | null = null
      if (needsResume) {
        try {
          // knownJobId is the authoritative jobId for this page — set by /check
          // (always when the job exists in the DB), /save (on fresh save), or
          // /analyze. With it the server returns the per-job tailored copy when
          // one exists; without it, primary resume is the fallback.
          const jobId =
            this.knownJobId ??
            this.analysis?.jobId ??
            this.saveResult?.jobId ??
            undefined
          resumeBytes = await fetchPrimaryResume({ jobId })
        } catch {
          // Leave resumeBytes null — applySafeFills will mark the field as
          // "No resume on file — upload one in Hireoven first."
        }
      }

      this.autofillResults = await applySafeFills(
        this.site as "greenhouse" | "lever",
        this.autofillProfile,
        resumeBytes,
        document,
      )
      this.autofillStatus = "done"

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
      this.autofillError = err instanceof Error ? err.message : "Fill failed"
    }
    this.render()
  }

  /** Cancel preview → return to idle without filling anything. */
  private onAutofillCancel(): void {
    this.autofillStatus = "idle"
    this.autofillPreview = null
    this.autofillResults = null
    this.autofillError = null
    this.render()
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
      const res = await generateCoverLetter({ jobId, ats })
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
          this.proofPromptDismissed = false
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
    this.proofError = null
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
      this.proofError = err instanceof Error ? err.message : "Save failed"
    }
    this.render()
  }

  private onDismissProofPrompt(): void {
    this.proofPromptDismissed = true
    this.render()
  }
}
