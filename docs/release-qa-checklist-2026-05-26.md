# Release QA Checklist (2026-05-26)

## Automated Gates

- [x] `npm test` passed (`371 pass, 0 fail, 15 skipped`).
- [x] `npm run build` passed (Next.js production build successful).
- [x] `npm run lint` passed (warnings only; no lint errors).

## Manual Product QA (Prod-like Data)

### Dashboard Core

- [ ] `/dashboard` loads without auth flicker/redirect loops.
- [ ] `/dashboard/search` jobs render with stable cards and no duplicate clusters.
- [ ] `/dashboard/watchlist` matches sidebar count and entries exactly.
- [ ] `/dashboard/jobs/[id]` opens job detail, sponsorship badge, and networking panel.
- [ ] `/dashboard/matches` sort by match works and missing scores hide reasoning blocks.

### Interview

- [ ] `/dashboard/interview` shows Free/Pro/Pro Max gating consistently.
- [ ] Live interview preflight acquires mic/cam and can reconnect after transient disconnect.
- [ ] Coding interview voice reconnect countdown/banner appears and recovers once.
- [ ] Text interview sends/receives turns without network or hydration errors.

### Resume + Extension

- [ ] `/dashboard/resume` and `/dashboard/resume/versions` load without SSR/client mismatch.
- [ ] Resume analysis + score pages render with primary resume context.
- [ ] Extension autofill telemetry events (`preview/attempt/success/partial/error`) land in backend.

### Billing + Plans

- [ ] `/pricing`, `/dashboard/upgrade`, `/dashboard/billing` show consistent plan names and prices.
- [ ] Live interview credit purchase + balance endpoints behave consistently.

### Admin / Reliability

- [ ] `/admin` loads reliability cards (duplicate/null-title/scraper-artifact/match-score-missing).
- [ ] 24h trend strip shows current vs previous windows and pp delta badges.
- [ ] Verify no unexpected spikes after deploy.

## Post-Deploy Monitoring (First 24h)

- [ ] Duplicate rate < 1%.
- [ ] Scraper artifact rate trends toward 0%.
- [ ] Match score missing rate < 2% on sampled personalized coverage.
- [ ] Watchlist mismatch rate remains 0%.
- [ ] Subscription mismatch rate remains 0%.
