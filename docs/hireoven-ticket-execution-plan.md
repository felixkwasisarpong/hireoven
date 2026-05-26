# Hireoven Ticket Execution Plan

Last updated: 2026-05-26
Source: `/Users/Apple/Downloads/Hireoven_Ticket_List.docx`

## Goal
Ship reliability first (P0/P1), then differentiation (P2). The product already has strong feature breadth; the fastest path is fixing data trust and state consistency.

## Priority Backlog

### P0 — Critical

| ID | Ticket | Owner Slice | Primary Files | Definition of Done |
|---|---|---|---|---|
| P0-1 | Deduplicate job feed | Ingestion + query layer | `lib/harvester/persist-bulk.ts`, `lib/crawler/persist.ts`, `app/api/jobs/route.ts` | Duplicate role clusters collapse to one canonical card per normalized `(company, title, location)`; no repeated runs of same role in feed. |
| P0-2 | Filter scraper-artifact records | Ingestion filters | `lib/jobs/filters.ts`, adapters in `lib/harvester/adapters/*` | Records like `Go to last page` / null / synthetic placeholders are blocked at ingest and absent in feed + applications. |
| P0-3 | Fix Watchlist desync | Unified source of truth | `app/api/watchlist/route.ts`, `lib/hooks/useWatchlist.ts`, `app/(dashboard)/dashboard/page.tsx`, `app/(dashboard)/dashboard/watchlist/page.tsx`, `components/dashboard/DashboardSpotlightColumn.tsx` | Sidebar and `/dashboard/watchlist` always show same tracked count and same entities for same user/session. |
| P0-4 | Employer vs end-client reconciliation | Entity resolution pipeline | `lib/jobs/normalization/*`, `lib/companies/*`, ingest routes/workers | Job cards display true hiring entity; staffing shell names no longer pollute sponsorship signal. |
| P0-5 | Billing plan vs price mismatch | Subscription normalization | `app/api/subscription/route.ts`, `lib/context/SubscriptionContext.tsx`, `app/(dashboard)/dashboard/billing/page.tsx`, Stripe webhook routes | Plan label, price, status, interval, and CTA are internally consistent and match Stripe state. |

### P1 — Core Quality

| ID | Ticket | Owner Slice | Primary Files | Definition of Done |
|---|---|---|---|---|
| P1-1 | Stable/cached match scores | Scoring persistence + cache | `lib/matching/*`, score APIs, feed cards | Score renders immediately after first compute and does not jitter across reloads. |
| P1-2 | Skill factor 0 ambiguity | Scoring schema + UI state | match breakdown API + detail UI | Distinguish `not_computed` from real `0`; no false-zero confusion. |
| P1-3 | Page load / skeleton latency | SSR + endpoint profiling | `app/(dashboard)/dashboard/*`, slow APIs (`/api/jobs`, `/api/companies`, interview/resume endpoints) | P95 page-interactive < 1.5s on dashboard views; skeleton visible under 1s for warm paths. |
| P1-4 | Remote flag/location conflict | Normalization rules | `lib/jobs/normalization/*`, location/workmode adapters | Remote-tagged jobs pass location sanity checks; obvious mismatches auto-downgraded or excluded. |
| P1-5 | Match unavailable + reasoning conflict | Feed card rendering contract | feed card components + API payload | If score missing, reasoning block hidden; UI never shows contradictory evidence. |
| P1-6 | Autofill extension E2E | Extension + backend contract | extension routes under `app/api/extension/*`, autofill pages | Greenhouse/Lever/Workday/Ashby form-fill works E2E with telemetry and error fallback. |
| P1-7 | Auth/session flicker | Session lifecycle hardening | auth hooks/routes/middleware, dashboard bootstrap | No identity flicker, no spurious `/login` redirect for valid sessions. |

### P2 — Differentiation

| ID | Ticket | Owner Slice | Primary Files | Definition of Done |
|---|---|---|---|---|
| P2-1 | Insider/networking finder | New graph + contact surface | new service + job detail UI | Per-job list of alumni/2nd-degree/recruiter contacts with confidence labels. |
| P2-2 | Ghost/repost detection | Freshness/repost model | `lib/jobs/ghost-scan-worker.ts`, feed labels | Jobs carry stale/repost flags with clear thresholds and user-facing explanations. |
| P2-3 | Resume versions vs outcomes | Funnel analytics join | resume version tables + application outcomes | User can see response/interview rate by resume version. |
| P2-4 | Better empty states | UX polish | watchlist/alerts empty state components | Empty states pre-populate suggestions and deep-link to meaningful actions. |
| P2-5 | Pro gating rationalization | Pricing IA cleanup | gates + upgrade surfaces | Consistent free/pro/pro-max model with predictable lock points. |
| P2-6 | Surface differentiators in IA | Marketing + nav | onboarding, nav, landing modules | H-1B intel, cohorts, fair chance features appear as top-level value props. |

## Sprint Sequence

1. Sprint 1 (P0 visibility wins)
- P0-1, P0-2, P0-3, P0-5

2. Sprint 2 (trust engine)
- P0-4, P1-1, P1-2, P1-4, P1-5

3. Sprint 3 (experience hardening)
- P1-3, P1-6, P1-7

4. Sprint 4+ (competitive moat)
- P2-1 first, then remaining P2

## Immediate Execution Checklist

- [x] Add ingest-time title/URL artifact blocklist expansion and tests (P0-2).
- [x] Add feed-level duplicate collapse guardrail (P0-1).
- [x] Unify watchlist source read path used by sidebar + page (P0-3).
- [x] Add subscription snapshot consistency check endpoint/test (P0-5).
- [x] Reconcile staffing intermediary postings to show true hiring entity and suppress company-level sponsorship leakage (P0-4).
- [x] Set up metrics dashboard for: duplicate rate, null-title rate, watchlist mismatch rate, subscription mismatch rate.
- [x] Add scraper-artifact rate guardrail to admin reliability metrics (blocked-title / blocked-apply-url leakage).
- [x] Add match-score missing rate guardrail to admin reliability metrics using sampled personalized feed coverage (active users x freshest jobs, freshness-epoch aware).
- [x] Add 24h vs previous 24h reliability trend strip (duplicate/null-title/scraper-artifact rates) on admin overview.
- [x] Unify match-score freshness and hydrate `/api/jobs?withScores=1` server-side to eliminate score jitter/spinner lag (P1-1).
- [x] Distinguish `not_computed` vs real `0` for skills factor in deep/fast score mapping and match breakdown UI (P1-2).
- [x] Split remaining client-only dashboard route entrypoints (`/dashboard/international/company/[id]`, `/dashboard/cover-letter/[jobId]`, `/dashboard/autofill/fill/[jobId]`) into server wrappers + client pages to reduce client bootstrap and improve first-paint stability (P1-3).
- [x] Reconcile remote/hybrid flags against location sanity to auto-downgrade obvious remote mismatches (specific city or explicit foreign remote location) before persistence (P1-4).
- [x] Enforce feed match-score contract so unavailable scores serialize as `null` and hide "Why it's a match" reasoning blocks (P1-5).
- [x] Complete extension autofill E2E coverage across Greenhouse/Lever/Workday/Ashby with stage telemetry (`preview/attempt/success/partial/error`) and Workday generic safe-fill fallback on runner failures (P1-6).
- [x] Seed auth context from server session in `RootLayout` and remove onboarding's non-401 login redirect path to eliminate identity flicker and spurious `/login` redirects (P1-7).
- [x] Ship per-job networking finder with alumni, recruiter, and second-degree contact buckets plus confidence labels on the job detail panel (P2-1).
- [x] Surface explicit ghost/repost feed labels using freshness/repost thresholds (`>45d`, `>90d`, `>=3`, `>=5`) with user-facing explanations on grid + list cards (P2-2).
- [x] Add resume-version outcome attribution and show applications, response rate, and interview rate per version on `/dashboard/resume/versions` (P2-3).
- [x] Improve watchlist and alerts empty states with quick-start templates/suggestions and deep links to meaningful next actions (P2-4).
- [x] Rationalize plan gating and upgrade surfaces to a consistent Free/Pro/Pro Max model (including live interview credits lock-point messaging) across pricing, upgrade, billing, and interview hub flows (P2-5).
- [x] Surface H-1B intel, cohorts, and fair-chance features as first-class IA value props across dashboard nav, onboarding, and landing modules (P2-6).

## Success Metrics

- Duplicate listings rate in first 50 feed cards: < 1%
- Scraper-artifact cards surfaced: 0
- Watchlist mismatch incidents: 0
- Plan/price mismatch incidents: 0
- Match score missing on visible cards: < 2%

## Rollout Readiness

- [x] Local automated verification (`npm test`, `npm run build`) passes on 2026-05-26.
- [ ] Manual QA sweep on production-like environment (dashboard + interview + extension + billing).
- [ ] Merge PR after CI is green and monitor reliability metrics for 24h.
