# Job Normalization Architecture

## Product intent
Crawler collects raw job data, normalizer converts it to a canonical schema, validator checks quality, frontend renders only the canonical view model.

## Insertion points in this codebase
- Crawler ingestion: `app/api/crawl/route.ts`
- Crawler persistence: `lib/crawler/persist.ts`
- Re-normalization endpoint: `app/api/admin/jobs/renormalize/route.ts`
- Dashboard detail rendering: `app/(dashboard)/dashboard/jobs/[id]/page.tsx`
- Public detail rendering: `app/(public)/jobs/[id]/page.tsx`
- Feed cards: `components/jobs/JobCard.tsx`

## New normalization modules
- `lib/jobs/normalization/types.ts`: canonical schema, confidence/provenance, view model contracts
- `lib/jobs/normalization/source-adapters.ts`: source adapter detection + source payload shaping
- `lib/jobs/normalization/ats-adapters.ts`: ATS-first structured extraction (Greenhouse, Lever, Ashby, Workday, iCIMS, BambooHR, Oracle, Phenom, Google)
- `lib/jobs/normalization/section-taxonomy.ts`: canonical section labels + deterministic heading/content mapping
- `lib/jobs/normalization/sections.ts`: section extraction, classification, fallback filling
- `lib/jobs/normalization/validator.ts`: quality rules + review flagging
- `lib/jobs/normalization/view-model.ts`: page/card rendering contracts
- `lib/jobs/normalization/normalize.ts`: pipeline orchestrator for crawler and persisted rows
- `lib/jobs/normalization/read-model.ts`: runtime resolver that reads stored normalized data with deterministic fallback

## Canonical sections
- `header`
- `compensation`
- `visa`
- `about_role`
- `responsibilities`
- `requirements`
- `preferred_qualifications`
- `benefits`
- `company_info`
- `application_info`
- `other`

## Deterministic-first pipeline
1. Source adapter detects ATS from `external_id`/URL.
2. ATS adapters extract structured fields first for known systems.
3. Structured ATS fields are applied with highest confidence.
4. Description gets split into semantic blocks.
5. Blocks are mapped by heading taxonomy + deterministic heuristics.
6. Safe fallbacks fill missing core sections.
7. Validator computes completeness/confidence and `requires_review` flag.
8. Renderer consumes `JobPageViewModel` and `JobCardViewModel` only.

### ATS-first rollout policy
- Prioritize normalization quality for ATS-backed jobs first.
- Keep `generic_html`/`unknown` sources conservative (minimal assumptions).
- Add source-specific custom adapters only after ATS adapters stabilize.

## Storage strategy
Current implementation stores both raw and normalized payloads inside `jobs.raw_data` for backward compatibility:
- `raw_data.raw`: original crawl payload snapshot
- `raw_data.normalized`: canonical normalized model
- `raw_data.view.page`: page-facing view model
- `raw_data.view.card`: feed-card view model
- `raw_data.normalization`: quality/confidence summary + issues

This avoids breaking existing installs that do not yet run schema migrations.

## Optional dedicated DB schema (recommended)
If you want stronger queryability and lower `jobs` row bloat, move normalized payloads into dedicated columns/table.

Suggested table:
- `job_normalizations`
  - `job_id uuid primary key references jobs(id)`
  - `schema_version text not null`
  - `source_adapter text not null`
  - `canonical_payload jsonb not null`
  - `page_view_payload jsonb not null`
  - `card_view_payload jsonb not null`
  - `confidence_score numeric not null`
  - `completeness_score numeric not null`
  - `requires_review boolean not null`
  - `issues jsonb not null default '[]'::jsonb`
  - `created_at timestamptz default now()`
  - `updated_at timestamptz default now()`

## Backward compatibility
- Existing flat `jobs` columns stay populated.
- Existing API consumers continue to work.
- New frontend rendering reads canonical view model first, then deterministic fallback if older rows are not normalized yet.

## Example transformations
- Run `npm run jobs:generate-normalization-examples` to produce raw -> canonical examples.
- Output file: `scripts/output/job-normalization-examples.json`.
- Details: `docs/job-normalization-examples.md`.
