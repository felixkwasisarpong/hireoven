# Glassdoor Company Discovery

This worker uses Glassdoor only as a company-name seed source. It stores company candidates and provenance, then queues inactive placeholder companies for the existing official-domain/careers/ATS resolver path. It does not scrape Glassdoor job details, reviews, salaries, private user content, or login-gated pages.

## Setup

Apply the migration:

```bash
psql "$DATABASE_URL" -f scripts/migrations/add-glassdoor-company-discovery.sql
```

Enable and run locally:

```bash
GLASSDOOR_DISCOVERY_ENABLED=true npx tsx scripts/glassdoor-discovery-worker.ts --execute
```

Dry-run preview:

```bash
npx tsx scripts/glassdoor-discovery-worker.ts
```

Cron endpoint:

```bash
bash scripts/crons.sh glassdoor-discovery
```

## Configuration

Edit `scripts/config/glassdoor-discovery.json` or set `GLASSDOOR_DISCOVERY_CONFIG=/path/to/config.json`. The config controls sector keywords, U.S. location keywords, and the search URL template.

The template supports `{sector}`, `{location}`, and `{page}` placeholders. Every generated URL is checked against robots.txt immediately before fetch.

## Safety Stops

The run stops and marks Glassdoor as blocked when it sees 403, 429, 503, login redirects, CAPTCHA markers, Cloudflare/DataDome/bot-check markers, or other access-control signals. Disallowed robots paths are skipped, not fetched. Request limits are bounded by per-run and daily budgets.

## Resolver Flow

`discovered_company_candidates` stores the raw name, normalized name, source URL, keyword provenance, timestamps, and status. New candidates create inactive `companies` placeholders with `raw_ats_config.source = 'glassdoor_company_discovery'`. Run `scripts/enrich-placeholder-companies.ts --execute` to resolve official domains/careers/ATS data and activate only verified companies.
