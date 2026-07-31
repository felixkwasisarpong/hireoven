/**
 * Programmatic SEO job collections.
 *
 * A curated registry of "browse jobs by X" landing pages — role, location,
 * remote, ATS, and visa — each backed by a SQL predicate over the live job
 * index. One dynamic route (app/(public)/jobs/browse/[slug]) renders any of
 * them, and the hub (app/(public)/jobs/browse) links them all.
 *
 * Every collection query joins `companies c` so predicates can reference the
 * employer (ats_type, sponsorship history) and rows can show a logo. The base
 * filter reuses the same published + US-located guards the per-company pages
 * use, so a collection never surfaces a job the rest of the site would hide.
 */

import type { Pool } from "pg"
import { sqlSeoVisibleJob } from "@/lib/jobs/publication"
import { sqlJobLocatedInUsa } from "@/lib/jobs/usa-job-sql"
import type { PublicJobRow } from "@/lib/jobs/format"

export type CollectionKind = "role" | "remote" | "location" | "ats" | "visa"

export interface JobCollection {
  slug: string
  kind: CollectionKind
  /** Short label for nav / chips, e.g. "AI Engineer". */
  label: string
  /** Page H1, e.g. "AI Engineer jobs". */
  h1: string
  /** One-sentence intro shown under the H1. */
  tagline: string
  /** <title> — {count} is replaced with the live total. */
  seoTitle: string
  /** meta description — {count} is replaced with the live total. */
  seoDescription: string
  /**
   * SQL boolean (no leading AND) selecting the collection's jobs. May reference
   * alias `j` (jobs) and `c` (companies).
   */
  predicate: string
}

// ── Reusable predicate fragments ────────────────────────────────────────────

const AI_ROLE = `(
  j.title ~* '\\m(ai|ml|llm|nlp)\\M'
  OR j.title ILIKE '%machine learning%'
  OR j.title ILIKE '%artificial intelligence%'
  OR j.title ILIKE '%deep learning%'
  OR j.title ILIKE '%generative ai%'
  OR j.title ILIKE '%computer vision%'
  OR j.title ILIKE '%data scientist%'
  OR j.title ILIKE '%mlops%'
  OR j.title ILIKE '%applied scientist%'
)`

const SWE_ROLE = `(
  j.title ~* '\\m(swe|sde)\\M'
  OR j.title ILIKE '%software engineer%'
  OR j.title ILIKE '%software developer%'
  OR j.title ILIKE '%backend%'
  OR j.title ILIKE '%back-end%'
  OR j.title ILIKE '%frontend%'
  OR j.title ILIKE '%front-end%'
  OR j.title ILIKE '%full stack%'
  OR j.title ILIKE '%full-stack%'
)`

const NEW_GRAD = `(
  j.seniority_level IN ('intern', 'junior')
  OR j.title ILIKE '%new grad%'
  OR j.title ILIKE '%new graduate%'
  OR j.title ILIKE '%university graduate%'
  OR j.title ILIKE '%entry level%'
  OR j.title ILIKE '%entry-level%'
  OR j.title ILIKE '%early career%'
  OR j.title ILIKE '%recent graduate%'
)`

const HAS_SPONSORSHIP = `(
  j.sponsors_h1b = true
  OR c.sponsors_h1b = true
  OR COALESCE(c.h1b_sponsor_count_1yr, 0) > 0
)`

// Texas / California by free-text location. State abbreviation as a word,
// full state name, or a major city. CA excludes anything tagged Canada so the
// two-letter "CA" can't drag in Canadian remote postings.
const TEXAS = `(
  j.location ~* '\\mTX\\M'
  OR j.location ILIKE '%texas%'
  OR j.location ILIKE '%austin%'
  OR j.location ILIKE '%dallas%'
  OR j.location ILIKE '%houston%'
  OR j.location ILIKE '%san antonio%'
  OR j.location ILIKE '%fort worth%'
)`

const CALIFORNIA = `(
  (
    j.location ~* '\\mCA\\M'
    OR j.location ILIKE '%california%'
    OR j.location ILIKE '%san francisco%'
    OR j.location ILIKE '%los angeles%'
    OR j.location ILIKE '%san jose%'
    OR j.location ILIKE '%san diego%'
    OR j.location ILIKE '%palo alto%'
    OR j.location ILIKE '%mountain view%'
    OR j.location ILIKE '%sunnyvale%'
    OR j.location ILIKE '%cupertino%'
  )
  AND j.location NOT ILIKE '%canada%'
)`

// ── Registry ────────────────────────────────────────────────────────────────

export const JOB_COLLECTIONS: JobCollection[] = [
  {
    slug: "ai-engineer",
    kind: "role",
    label: "AI Engineer",
    h1: "AI Engineer jobs",
    tagline:
      "AI, ML, and data-science roles pulled straight from company career pages — before they flood the job boards.",
    seoTitle: "AI Engineer jobs — {count} fresh roles hiring now | Hireoven",
    seoDescription:
      "{count} AI, machine-learning, and data-science jobs discovered directly from company career pages, refreshed continuously in the US. Titles, locations, salaries, and H-1B sponsorship intel.",
    predicate: AI_ROLE,
  },
  {
    slug: "software-engineer",
    kind: "role",
    label: "Software Engineer",
    h1: "Software Engineer jobs",
    tagline:
      "Backend, frontend, and full-stack engineering roles from company career pages, updated in near real time.",
    seoTitle: "Software Engineer jobs — {count} fresh roles hiring now | Hireoven",
    seoDescription:
      "{count} software engineering jobs discovered directly from company career pages across the US, refreshed continuously. Backend, frontend, full-stack — with salary and sponsorship signals.",
    predicate: SWE_ROLE,
  },
  {
    slug: "new-grad",
    kind: "role",
    label: "New Grad",
    h1: "New-grad & entry-level jobs",
    tagline:
      "Entry-level, new-grad, and internship roles — the ones that fill fastest, surfaced the moment they post.",
    seoTitle: "New grad jobs — {count} entry-level roles hiring now | Hireoven",
    seoDescription:
      "{count} new-grad and entry-level jobs from company career pages, refreshed continuously in the US. Perfect for students and recent graduates — with H-1B and OPT sponsorship signals.",
    predicate: NEW_GRAD,
  },
  {
    slug: "remote",
    kind: "remote",
    label: "Remote",
    h1: "Remote jobs",
    tagline:
      "US-based remote roles from company career pages, refreshed continuously — no aggregator noise.",
    seoTitle: "Remote jobs — {count} US remote roles hiring now | Hireoven",
    seoDescription:
      "{count} remote jobs discovered directly from US company career pages, updated in near real time. Filter by title, see salaries, and catch new postings before the boards do.",
    predicate: "j.is_remote = true",
  },
  {
    slug: "texas",
    kind: "location",
    label: "Texas",
    h1: "Texas jobs",
    tagline: "Roles across Austin, Dallas, Houston, and the rest of Texas — fresh from company career pages.",
    seoTitle: "Texas jobs — {count} roles hiring now | Hireoven",
    seoDescription:
      "{count} jobs across Texas — Austin, Dallas, Houston, San Antonio — discovered directly from company career pages and refreshed continuously.",
    predicate: TEXAS,
  },
  {
    slug: "california",
    kind: "location",
    label: "California",
    h1: "California jobs",
    tagline: "Bay Area and SoCal roles from company career pages, updated in near real time.",
    seoTitle: "California jobs — {count} roles hiring now | Hireoven",
    seoDescription:
      "{count} jobs across California — San Francisco, San Jose, Los Angeles, San Diego — discovered directly from company career pages and refreshed continuously.",
    predicate: CALIFORNIA,
  },
  {
    slug: "workday",
    kind: "ats",
    label: "Workday",
    h1: "Jobs at Workday companies",
    tagline:
      "Live roles at companies hiring through Workday — pulled straight from their career pages the moment they post.",
    seoTitle: "Workday companies hiring — {count} jobs live now | Hireoven",
    seoDescription:
      "{count} jobs at companies that hire through Workday, discovered directly from their career pages and refreshed continuously across the US.",
    predicate: "c.ats_type = 'workday'",
  },
  {
    slug: "greenhouse",
    kind: "ats",
    label: "Greenhouse",
    h1: "Jobs at Greenhouse companies",
    tagline:
      "Live roles at companies hiring through Greenhouse — surfaced in near real time from their career pages.",
    seoTitle: "Greenhouse companies hiring — {count} jobs live now | Hireoven",
    seoDescription:
      "{count} jobs at companies that hire through Greenhouse, discovered directly from their career pages and refreshed continuously across the US.",
    predicate: "c.ats_type = 'greenhouse'",
  },
  {
    slug: "ashby",
    kind: "ats",
    label: "Ashby",
    h1: "Jobs at Ashby companies",
    tagline:
      "Live roles at fast-growing companies hiring through Ashby — fresh from their career pages.",
    seoTitle: "Ashby companies hiring — {count} jobs live now | Hireoven",
    seoDescription:
      "{count} jobs at companies that hire through Ashby, discovered directly from their career pages and refreshed continuously across the US.",
    predicate: "c.ats_type = 'ashby'",
  },
  {
    slug: "h1b",
    kind: "visa",
    label: "H-1B",
    h1: "H-1B sponsorship jobs",
    tagline:
      "Roles at employers with a track record of sponsoring H-1B visas — backed by certified DOL filings.",
    seoTitle: "H-1B sponsorship jobs — {count} roles at sponsoring employers | Hireoven",
    seoDescription:
      "{count} jobs at companies with documented H-1B sponsorship history, discovered directly from career pages. Built for international candidates who need a visa-friendly employer.",
    predicate: HAS_SPONSORSHIP,
  },
  {
    slug: "opt",
    kind: "visa",
    label: "OPT",
    h1: "OPT-friendly jobs",
    tagline:
      "Roles at sponsor-friendly employers that don't require existing work authorization — a strong starting point for F-1 / STEM-OPT candidates.",
    seoTitle: "OPT jobs — {count} roles at sponsor-friendly employers | Hireoven",
    seoDescription:
      "{count} jobs at companies with H-1B sponsorship history that don't require prior work authorization — a shortlist for OPT and STEM-OPT candidates, refreshed continuously.",
    predicate: `${HAS_SPONSORSHIP} AND COALESCE(j.requires_authorization, false) = false`,
  },
]

const BY_SLUG = new Map(JOB_COLLECTIONS.map((c) => [c.slug, c]))

export function getCollection(slug: string): JobCollection | null {
  return BY_SLUG.get(slug) ?? null
}

export function allCollectionSlugs(): string[] {
  return JOB_COLLECTIONS.map((c) => c.slug)
}

export const KIND_LABELS: Record<CollectionKind, string> = {
  role: "By role",
  remote: "Remote",
  location: "By location",
  ats: "By hiring platform",
  visa: "By visa",
}

function baseWhere(predicate: string): string {
  return `
    j.is_active = true
    AND ${sqlSeoVisibleJob("j")}
    AND ${sqlJobLocatedInUsa("j", { companyAlias: "c" })}
    AND (${predicate})
  `
}

export interface CollectionListing {
  total: number
  jobs: PublicJobRow[]
}

/** Latest N jobs for a collection plus the total count. */
export async function listCollection(
  pool: Pool,
  collection: JobCollection,
  limit = 50,
): Promise<CollectionListing> {
  const where = baseWhere(collection.predicate)
  const [jobsRes, countRes] = await Promise.all([
    pool.query<PublicJobRow>(
      `SELECT j.id, j.title, j.location, j.is_remote,
              j.salary_min, j.salary_max, j.salary_currency, j.first_detected_at,
              c.name AS company_name, c.domain AS company_domain, c.logo_url AS company_logo_url
         FROM jobs j
         JOIN companies c ON c.id = j.company_id
        WHERE ${where}
        ORDER BY j.first_detected_at DESC NULLS LAST
        LIMIT $1`,
      [limit],
    ),
    pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n
         FROM jobs j
         JOIN companies c ON c.id = j.company_id
        WHERE ${where}`,
    ),
  ])
  return { total: countRes.rows[0]?.n ?? 0, jobs: jobsRes.rows }
}

/** Just the count for a collection (used by the hub). */
export async function countCollection(pool: Pool, collection: JobCollection): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n
       FROM jobs j
       JOIN companies c ON c.id = j.company_id
      WHERE ${baseWhere(collection.predicate)}`,
  )
  return rows[0]?.n ?? 0
}

/** Counts for every collection, keyed by slug. */
export async function countAllCollections(pool: Pool): Promise<Record<string, number>> {
  const selectList = JOB_COLLECTIONS.map(
    (collection) =>
      `COUNT(*) FILTER (WHERE (${collection.predicate}))::int AS "${collection.slug}"`,
  ).join(",\n       ")
  const { rows } = await pool.query<Record<string, number>>(
    `SELECT ${selectList}
       FROM jobs j
       JOIN companies c ON c.id = j.company_id
      WHERE j.is_active = true
        AND ${sqlSeoVisibleJob("j")}
        AND ${sqlJobLocatedInUsa("j", { companyAlias: "c" })}`,
  )
  const row = rows[0] ?? {}
  return Object.fromEntries(
    JOB_COLLECTIONS.map((collection) => [
      collection.slug,
      Number(row[collection.slug] ?? 0),
    ]),
  )
}
