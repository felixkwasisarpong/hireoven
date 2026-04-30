# Scout QA Checklist — Launch Readiness V1

Manual test script for Scout OS. Run before every major release.
Mark each item ✅ pass / ❌ fail / ⚠️ partial.

---

## 0. Prerequisites

- [ ] Chrome extension installed + logged in
- [ ] At least 3 saved jobs in the watchlist
- [ ] A parsed resume uploaded
- [ ] At least 2 past applications in the tracker
- [ ] Dev tools console open to monitor for errors

---

## 1. Scout Workspace — Core Navigation

| # | Test | Expected |
|---|------|----------|
| 1.1 | Navigate to `/dashboard/scout` | Scout OS loads; idle mode shown; no console errors |
| 1.2 | Type a message and submit | Streaming text appears; workspace transitions to correct mode |
| 1.3 | Press `Cmd+K` / `Ctrl+K` | Command palette opens |
| 1.4 | Click "Start fresh" | Chat cleared; workspace returns to idle |
| 1.5 | Refresh the page | Session restored (mode + chips) from localStorage |
| 1.6 | Switch tabs and return | Browser context rail updates when extension is active |

---

## 2. Command: Search / Filter

| # | Test | Expected |
|---|------|----------|
| 2.1 | "Show backend jobs with H-1B sponsorship" | Workspace morphs to `search`; APPLY_FILTERS action present |
| 2.2 | "Remote-only roles over 70% match" | Filters applied correctly; narrative strip shown |
| 2.3 | "Focus mode" | SET_FOCUS_MODE fires; badge in header shows SEARCH |
| 2.4 | "Turn off focus mode" | Focus mode disabled; badge clears |

---

## 3. Command: Compare Jobs

| # | Test | Expected |
|---|------|----------|
| 3.1 | "Compare my saved jobs" | Workspace morphs to `compare`; CompareMode shows ≥ 2 jobs |
| 3.2 | "Which one sponsors H-1B?" | Compare items show sponsorship signals |
| 3.3 | Click winner job | Navigates to job detail page |
| 3.4 | "Compare my saved jobs" with 0 saved | Graceful error: "Save a job first" |

---

## 4. Command: Tailor Resume

| # | Test | Expected |
|---|------|----------|
| 4.1 | "Tailor my resume" | Workspace morphs to `tailor`; resolved job shown |
| 4.2 | "Tailor for this role" on a job page | Job context carried into TailorMode |
| 4.3 | "Tailor my resume" with no saved jobs | Graceful: "Save a job first" message |
| 4.4 | Click "Open Resume Studio" | Opens `/dashboard/resume/tailor?jobId=...` |
| 4.5 | Original resume is NOT overwritten | Verify in Resume section — original unchanged |

---

## 5. Command: Application Workflow

| # | Test | Expected |
|---|------|----------|
| 5.1 | "Prepare my application" | Workflow starts in ApplicationMode; steps shown |
| 5.2 | Click "Continue" on a waiting step | Step advances; next step activates |
| 5.3 | Click "Skip" on a step | Step marked skipped; workflow continues |
| 5.4 | Close browser + reopen | Active workflow restored from sessionStorage |
| 5.5 | "Prepare 5 applications for remote backend jobs" | BulkApplicationMode activates; queue builds |

---

## 6. Extension Overlay

| # | Test | Expected |
|---|------|----------|
| 6.1 | Open a Greenhouse job URL | Extension overlay appears; job title + company detected |
| 6.2 | Open a Lever job URL | Overlay appears; ATS badge shows "Lever" |
| 6.3 | Open a Workday application form | Overlay detects `application_form`; autofill CTA shown |
| 6.4 | Open LinkedIn Jobs | Page type detected as `search_results` or `job_detail` |
| 6.5 | Navigate SPA (LinkedIn) | Overlay updates on URL change without page reload |
| 6.6 | Open a non-job page | Overlay does NOT appear on unrecognised sites |
| 6.7 | Duplicate overlay check | Refreshing a page does not mount overlay twice |

---

## 7. Autofill Drawer

| # | Test | Expected |
|---|------|----------|
| 7.1 | Open Greenhouse form + click "Review autofill" | Autofill drawer opens in extension |
| 7.2 | Check field groupings | Fields grouped by category; each shows suggested value |
| 7.3 | Edit a field value | Field value updates; AI suggestion NOT overwritten silently |
| 7.4 | Click "Fill all safe fields" | Non-sensitive fields filled; sponsorship/legal fields NOT auto-filled |
| 7.5 | Sensitive question (Work Auth) | Field highlighted; user prompted to answer manually |
| 7.6 | Submit button | Submit button is NOT clicked automatically |
| 7.7 | "Review autofill fields" from Scout rail | `prepare_autofill` operator action dispatched; action strip shown |

---

## 8. Permissions System

| # | Test | Expected |
|---|------|----------|
| 8.1 | Open Scout permissions panel | All permissions shown with current state |
| 8.2 | Disable "Autofill fields" permission | Autofill actions return "Permission denied" error |
| 8.3 | Re-enable permission | Actions work again |
| 8.4 | Try to submit application via Scout | Hard-blocked: never dispatched |
| 8.5 | Try to overwrite original resume silently | Hard-blocked: never dispatched |
| 8.6 | Permission denial logged | Timeline shows `permission_prompt` event |

---

## 9. Timeline + Session Replay

| # | Test | Expected |
|---|------|----------|
| 9.1 | Click clock icon in Scout header | Timeline panel slides open |
| 9.2 | Submit a Scout command | `command` event appears in timeline |
| 9.3 | Workspace transitions | `workspace_change` events appear |
| 9.4 | Extension detects a page | `extension_detected_page` event appears |
| 9.5 | Click ↩ on a command event | Command bar pre-filled with original message |
| 9.6 | Filter by "Workflows" | Only workflow events shown |
| 9.7 | Click "Clear" | Timeline cleared; panel shows "No activity yet" |
| 9.8 | Refresh page | Timeline events restored from localStorage (within 48 h) |

---

## 10. Interview Copilot

| # | Test | Expected |
|---|------|----------|
| 10.1 | "Prepare me for this interview" (with job loaded) | InterviewPrepMode opens; prep plan shown |
| 10.2 | "Prepare me for the technical round" | Interview type detected as `technical` |
| 10.3 | Click category filter | Questions filtered to selected category |
| 10.4 | Click "Ask Scout" on a question | Command bar pre-filled with "Help me answer: …" |
| 10.5 | Click "Start Mock Interview" | ScoutMockInterview component launches |
| 10.6 | Mock interview completes | Session saved to localStorage |

---

## 11. Outreach Copilot

| # | Test | Expected |
|---|------|----------|
| 11.1 | "Draft a LinkedIn message for this role" | OutreachMode opens; draft displayed in textarea |
| 11.2 | Draft contains [Name] placeholder | Placeholder present when recipient name unknown |
| 11.3 | Edit draft content | Textarea is editable; changes persist client-side |
| 11.4 | Click "Copy to clipboard" | Draft text copied; button shows ✓ |
| 11.5 | Draft does NOT include resume/application text | No sensitive data leaked into draft |
| 11.6 | Submit button | There is no submit button — user copies and sends manually |

---

## 12. Research Mode

| # | Test | Expected |
|---|------|----------|
| 12.1 | "Research visa-friendly backend companies" | Research mode activates; steps stream in |
| 12.2 | Steps appear progressively | Each step (1–5) appears in sequence |
| 12.3 | Findings stream in | Finding cards appear as synthesis completes |
| 12.4 | "Stop" button | Research cancelled; mode stays in current state |
| 12.5 | Click "Queue those jobs" | Command bar pre-filled with queue command |

---

## 13. Career Strategy

| # | Test | Expected |
|---|------|----------|
| 13.1 | "What direction fits my profile best?" | CareerStrategyMode opens with directions |
| 13.2 | Directions have confidence levels | No direction shows > 88% confidence |
| 13.3 | Evidence sentences use cautious language | "appears", "suggests", "based on patterns" |
| 13.4 | No guaranteed outcomes | No direction says "guaranteed" or "will" |
| 13.5 | Click "Queue jobs" on a direction | Command bar pre-filled with queue command |

---

## 14. Error Handling + Fallbacks

| # | Test | Expected |
|---|------|----------|
| 14.1 | Disconnect internet + submit command | Error shown in chat bubble; no crash |
| 14.2 | Close extension + trigger autofill | "Extension not connected" error in action strip |
| 14.3 | No saved jobs + tailor command | Graceful: "Save a job first" message |
| 14.4 | Scout returns malformed JSON | `getScoutDisplayText` shows fallback; no JSON in UI |
| 14.5 | Network timeout on `/api/scout/chat` | Error message; retry chip shown |
| 14.6 | React component crash in workspace | Error boundary shown; rest of Scout intact |

---

## 15. Safety Verification

| # | Test | Required result |
|---|------|-----------------|
| 15.1 | Check localStorage for sensitive values | MUST be empty of form values, resume text, answers |
| 15.2 | Check sessionStorage audit log | Only action types + safe metadata; no PII |
| 15.3 | Auto-submit test | MUST NOT occur under any Scout command |
| 15.4 | Silent resume overwrite test | MUST NOT occur; always shows preview first |
| 15.5 | JSON leaked to chat UI | MUST NOT appear; only human prose in bubbles |
| 15.6 | Wrong job IDs in actions | Action filter must strip hallucinated IDs |

---

## 16. Legacy Dashboard

| # | Test | Expected |
|---|------|----------|
| 16.1 | Click "Advanced" link in Scout header | Opens `/dashboard/scout/legacy` |
| 16.2 | Legacy Scout tab functions | All legacy Scout features work independently |
| 16.3 | Return from legacy to Scout OS | Scout OS state preserved (mode, session) |

---

## 17. Mobile / Responsive

| # | Test | Expected |
|---|------|----------|
| 17.1 | Scout OS on mobile viewport | Command bar visible; workspace responsive |
| 17.2 | Mobile context sheet | Bottom sheet opens with browser context cards |
| 17.3 | Timeline panel on mobile | Opens in full-width right rail or bottom sheet |
| 17.4 | Workspace mode labels | Mode badge readable on small screens |

---

## 18. Performance Checks

| # | Check | Target |
|---|-------|--------|
| 18.1 | Initial Scout page load | < 3 s LCP |
| 18.2 | Command submission → first text | < 800 ms to first streaming token |
| 18.3 | Workspace mode transition | < 300 ms (CSS fade) |
| 18.4 | Extension context update | Debounced; no duplicate events within 500 ms |
| 18.5 | Console errors on idle | Zero errors after 60 s of idle |

---

## Sign-off

| Role | Name | Date | Sign-off |
|------|------|------|----------|
| Frontend | | | |
| Extension | | | |
| Backend | | | |

---

*Last updated: 2026-04-30*
*Version: 1.0*
