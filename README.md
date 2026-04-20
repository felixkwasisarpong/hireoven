# Hireoven

Real-time job monitoring platform. Crawls thousands of company career pages every 30 minutes and surfaces new listings with H1B sponsorship intel.

## Tech stack

| Layer | Tech |
|---|---|
| Framework | Next.js 14 (App Router) |
| Database | Supabase (Postgres + Auth + Storage) |
| Styling | Tailwind CSS + shadcn/ui |
| AI | Anthropic Claude (job enrichment) |
| Email | Resend |
| Push notifications | Web Push |
| Analytics | Vercel Analytics |
| Hosting | Docker (e.g. [Coolify](docs/coolify.md)) |

## Local setup

### Prerequisites

- Node.js 20+
- A Supabase project (free tier works)
- A Resend account for emails (optional for local dev)

### 1. Clone and install

```bash
git clone https://github.com/your-org/hireoven
cd hireoven
npm install
```

### 2. Environment variables

Copy the example file and fill in your values:

```bash
cp .env.production.example .env.local
```

Minimum required for local dev:

```
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### 3. Run the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### 4. Seed test data (optional)

```bash
node scripts/seed-jobs.mjs
```

This creates ~56 test jobs across 20 companies so the dashboard and public pages have content.

## Project structure

```
app/
  (auth)/           # Login, signup, callback routes
  (dashboard)/      # Authenticated user dashboard (jobs, alerts, companies, settings)
  (public)/         # Public SEO pages (companies list, company detail, job detail)
  admin/            # Internal admin panel (requires admin role)
  api/
    crawl/          # Cron route: crawl all active companies
    alerts/
      digest/       # Daily alert email cron
      weekly/       # Weekly alert email cron
    webhooks/
      supabase/     # Supabase webhook for instant job notifications
    health/         # Health check endpoint
  page.tsx          # Landing page
  sitemap.ts        # Dynamic sitemap
  robots.ts         # robots.txt

components/
  layout/           # Navbar, sidebar
  ui/               # shadcn/ui primitives
  jobs/             # Job card, job feed, filters
  alerts/           # Alert creation/management
  companies/        # Company card, company list

lib/
  supabase/         # Client, server, admin Supabase clients
  hooks/            # useJobs, useAlerts, useCompanies
  crawlers/         # Per-ATS crawl logic (Greenhouse, Lever, Workday, Ashby)
  notifications/    # Email and push notification helpers
  env.ts            # Zod env validation + cron/webhook auth helpers
  analytics.ts      # Vercel Analytics typed wrappers

types/              # Shared TypeScript types
scripts/            # Seed scripts, migrations
```

## Deployment

Production is intended to run as a **Docker** image (Next.js `standalone` output). See **[docs/coolify.md](docs/coolify.md)** for Coolify: repo root, Dockerfile build, port `3000`, env vars, and **scheduled HTTP jobs** for crawl and alert routes (replace Vercel Cron).

### Environment variables for production

See `.env.production.example` for the full list with comments. Key vars:

| Variable | Where to get it |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API |
| `ANTHROPIC_API_KEY` | console.anthropic.com |
| `RESEND_API_KEY` | resend.com → API Keys |
| `CRON_SECRET` | Generate with `openssl rand -hex 32` |
| `SUPABASE_WEBHOOK_SECRET` | Supabase → Database → Webhooks |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Generate with `npx web-push generate-vapid-keys` |

### Cron jobs

Not bundled in-repo: call these URLs on a schedule (Coolify scheduled tasks, systemd timer, external cron, etc.):

| Route | Suggested schedule | Purpose |
|---|---|---|
| `/api/crawl` | Every 30 min | Crawl all active companies for new jobs |
| `/api/alerts/digest` | 8am UTC daily | Send daily digest emails |
| `/api/alerts/weekly` | 9am UTC Monday | Send weekly digest emails |
| `/api/alerts/recent-jobs?segment=with-resume` | Every 6 hours | Send 75%+ resume-match recent jobs (max 5) |
| `/api/alerts/recent-jobs?segment=without-resume` | 8pm local / 20:00 UTC | End-of-day fresh jobs for users without resumes |

All cron routes verify `Authorization: Bearer {CRON_SECRET}` (see [docs/coolify.md](docs/coolify.md)).

### Health check

`GET /api/health` returns database connectivity status and last crawl timestamp. Use this for uptime monitoring.

## Database schema

The key tables are:

- `companies` — company metadata, ATS type, sponsorship confidence
- `jobs` — job listings with enriched fields (seniority, skills, salary, sponsorship)
- `alerts` — user-defined job alert filters
- `watchlists` — users watching specific companies
- `crawl_logs` — crawl history and error logs
- `notification_logs` — sent notification history

## Development notes

- `lib/env.ts` validates all required env vars at startup with Zod. Missing vars throw descriptive errors.
- Public pages use `export const revalidate = 3600` (ISR) — they rebuild every hour without a full deploy.
- `generateStaticParams` pre-renders the top 1000 jobs and all active companies at build time for SEO.
- The `useJobs` hook uses a ref pattern (`allJobsRef`) to avoid infinite re-render loops when polling for new jobs.
