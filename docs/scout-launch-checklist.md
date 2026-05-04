# Scout Public Launch Checklist — GO/NO-GO

This is the release gate checklist. Each item must be signed off before launch.
Different from `scout-qa-checklist.md` (manual test script) — this is the launch-day decision gate.

---

## 🔴 BLOCKERS — Must pass before launch

### Safety Hard Rules
- [ ] **Auto-submit disabled**: Verified no code path can trigger form submission without user action
- [ ] **Silent autofill disabled**: Verified no autofill fires without user opening the review drawer first
- [ ] **Silent resume overwrite disabled**: Original resumes never modified by Scout actions
- [ ] **JSON leakage**: `getScoutDisplayText()` strips all raw JSON; confirmed in 10 test queries
- [ ] **Sensitive field handling**: Work authorization, disability, veteran status — NEVER auto-filled
- [ ] **Permission system**: Hard-blocked actions remain blocked after permission changes
- [ ] **localStorage audit**: No PII, form values, or sensitive answers in localStorage

### Core Feature Reliability
- [ ] **Scout chat streaming**: P95 first-token latency < 2 s on prod infra
- [ ] **Compare mode**: Works with 2+ saved jobs; graceful fallback with 0 jobs
- [ ] **Tailor flow**: `resolveJobContext()` returns a job in > 90% of cases where user has saved jobs
- [ ] **Workflow panel**: Session restoration works across page refreshes
- [ ] **Error boundaries**: Confirmed that a crashing workspace mode doesn't take down the whole shell
- [ ] **Hydration errors**: Zero `checkForUnmatchedText` errors in production build

### Extension
- [ ] **Greenhouse forms**: Autofill field detection confirmed working
- [ ] **Lever forms**: Field grouping confirmed
- [ ] **Workday forms**: Page type detection confirmed
- [ ] **SPA navigation**: Context updates on LinkedIn URL changes without reload
- [ ] **Duplicate overlay**: Confirmed one overlay per page, not two on reload
- [ ] **Unsupported pages**: No overlay on non-job sites (bank, news, etc.)

---

## 🟡 IMPORTANT — Strong recommendation to fix before launch

### Performance
- [ ] Lighthouse Performance score ≥ 70 on `/dashboard/scout`
- [ ] Scout page LCP < 3 s on slow 3G simulation
- [ ] No waterfall API calls on initial load (strategy/market/behavior load in parallel)
- [ ] Extension does not lag LinkedIn SPA navigation by > 700 ms

### Observability
- [ ] `scoutObserver` ring buffer confirmed not logging PII
- [ ] Error boundary `componentDidCatch` confirmed logging to observer
- [ ] At least one Vercel log alert configured for `scout_chat` errors

### UX / Copy
- [ ] Trust copy ("Scout prepares. You approve.") visible on first load
- [ ] Extension promo shown to users without extension connected
- [ ] First-run banner dismissed correctly and not shown again on return
- [ ] Empty state guidance for: no resume, no jobs, no extension

---

## 🟢 NICE TO HAVE — Can be fast-follow

- [ ] Demo mode for users with no saved jobs
- [ ] Scout section on public marketing landing page
- [ ] Scout feature highlighted in pricing comparison table
- [ ] Mobile PWA experience tested on iOS Safari
- [ ] Keyboard navigation fully tested (Tab, Enter, Esc)
- [ ] Reduced motion: animations respect `prefers-reduced-motion`
- [ ] Dark mode: confirmed Scout OS works in OS-level dark mode (if supported)

---

## Release Readiness Sign-offs

| Area | Owner | Signed | Date |
|------|-------|--------|------|
| Safety review | | | |
| Extension QA | | | |
| Performance | | | |
| Copy/UX review | | | |
| Backend/API | | | |
| Security review | | | |

---

## Rollback Plan

If a critical issue is found post-launch:
1. Set `NEXT_PUBLIC_SCOUT_OS_ENABLED=false` in Vercel env → Scout redirects to `/dashboard/scout/legacy`
2. No feature data is lost — Scout OS is a UI layer over existing data
3. Extension continues to work independently of the Scout OS flag
4. ETA to rollback: < 5 minutes (env var + redeploy or edge config override)

---

## Feature Flag States at Launch

| Flag | Launch Value | Notes |
|------|-------------|-------|
| `SCOUT_OS_ENABLED` | `true` | Master switch |
| `EXTENSION_BRIDGE_ENABLED` | `true` | Context bridge |
| `BROWSER_OPERATOR_ENABLED` | `true` | Supervised actions |
| `BULK_QUEUE_ENABLED` | `true` | Batch prep |
| `RESEARCH_MODE_ENABLED` | `true` | Autonomous research |
| `CAREER_STRATEGY_ENABLED` | `true` | Direction analysis |
| `INTERVIEW_COPILOT_ENABLED` | `true` | Interview prep |
| `OUTREACH_COPILOT_ENABLED` | `true` | Outreach drafts |
| `TIMELINE_ENABLED` | `true` | Activity log |
| `PROACTIVE_ENABLED` | `true` | Companion events |
| `ORCHESTRATOR_ENABLED` | `true` | Parallel agents |

To disable any feature: set env var to `false` in Vercel → redeploy (< 5 min).

---

*Last updated: 2026-04-30*
*Launch target: TBD*
