/**
 * Skill-gap → learning engine.
 *
 * Maps the user's current skills against the *live* job postings for their
 * target roles and answers the only question that matters: "what should I learn
 * next, and what does it unlock?" For each skill the user is missing we compute
 *   • how many target-role postings require it (demand),
 *   • how many postings they are exactly one skill away from (immediate unlock),
 *   • the median pay of postings that require it (comp signal),
 * then attach a course so the recommendation is actionable.
 *
 * Pure + unit-tested; the API does the SQL and auth. Keep it deterministic.
 *
 * Matching is alias-aware: both the user's skills and each posting's skills run
 * through the shared taxonomy (normalizeSkillList / normalizeSkillKey) so "JS" ==
 * "JavaScript", "golang" == "Go", "postgres" == "PostgreSQL" — otherwise the engine
 * reports skills the user already has as gaps.
 */

import {
  canonicalizeSkill,
  isKnownSkill,
  isSoftSkill,
  normalizeSkillKey,
  normalizeSkillList,
} from "@/lib/skills/taxonomy"

/** A target-role posting reduced to what the engine needs. */
export type SkillGapJob = {
  jobId: string
  /** Skills the posting lists, as stored (display casing preserved). */
  requiredSkills: string[]
  /** Salary midpoint in dollars, or null when the posting omits pay. */
  salary: number | null
}

export type CourseSuggestion = {
  provider: string
  title: string
  url: string
}

export type SkillGap = {
  skill: string
  /** Target-role postings that list this skill. */
  jobsRequiring: number
  /** Postings where this is the user's *only* missing skill — learn it, qualify. */
  oneAway: number
  /** Median pay of postings requiring this skill (null when too few list pay). */
  medianSalary: number | null
  /** medianSalary minus the median across all target postings (signed). */
  salaryUplift: number | null
  course: CourseSuggestion
}

export type SkillGapResult = {
  gaps: SkillGap[]
  /** Total postings in the target-role set the analysis ran against. */
  targetJobs: number
  /** Postings the user already has every listed skill for. */
  eligibleNow: number
  /** How many distinct skills the user currently has. */
  haveSkills: number
}

/** Min postings listing a skill before we surface it (cuts noise/one-offs). */
export const MIN_JOBS_FOR_GAP = 3
/** How many gaps to return. */
export const MAX_GAPS = 8

/** Plausible full-time annual salary band — drops hourly/part-time/garbage values
 *  (e.g. a "10000" or "25" mis-stored as the comp) so the pay signal isn't skewed. */
export const SALARY_MIN_PLAUSIBLE = 20_000
export const SALARY_MAX_PLAUSIBLE = 1_000_000

function plausibleSalary(v: number | null): number | null {
  return v != null && Number.isFinite(v) && v >= SALARY_MIN_PLAUSIBLE && v <= SALARY_MAX_PLAUSIBLE ? v : null
}

/** Taxonomy-aware comparison key: "JS" and "JavaScript" collapse to one key. */
function skillKey(s: string): string {
  return normalizeSkillKey(canonicalizeSkill(s))
}

/**
 * A posting's required skills reduced to ones we'd actually recommend learning:
 * canonicalized + noise-filtered (normalizeSkillList), then gated to genuine
 * taxonomy skills and stripped of generic soft skills. This is what keeps
 * non-skills ("Visual Merchandising", "Attention to Detail") and unlearnable
 * fluff ("Communication") out of the gap list — the user's complaint.
 */
function actionableSkills(raw: string[]): string[] {
  return normalizeSkillList(raw).filter((s) => isKnownSkill(s) && !isSoftSkill(s))
}

function median(values: number[]): number | null {
  const xs = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b)
  if (xs.length === 0) return null
  const mid = Math.floor(xs.length / 2)
  return xs.length % 2 ? xs[mid] : Math.round((xs[mid - 1] + xs[mid]) / 2)
}

// ── Course catalog ────────────────────────────────────────────────────────────
// Curated, high-intent mappings for the skills that show up most in tech/visa
// postings. Affiliate tags live in COURSE_AFFILIATE so they can be swapped in
// one place. Anything not in the catalog falls back to a Coursera search.

const COURSE_AFFILIATE = process.env.NEXT_PUBLIC_COURSE_AFFILIATE_TAG ?? ""

function withTag(url: string): string {
  if (!COURSE_AFFILIATE) return url
  const sep = url.includes("?") ? "&" : "?"
  return `${url}${sep}irgwc=1&utm_source=hireoven&aff=${encodeURIComponent(COURSE_AFFILIATE)}`
}

type CatalogEntry = { provider: string; title: string; url: string }

const COURSE_CATALOG: Record<string, CatalogEntry> = {
  kubernetes: { provider: "Coursera", title: "Architecting with Google Kubernetes Engine", url: "https://www.coursera.org/specializations/architecting-google-kubernetes-engine" },
  terraform: { provider: "HashiCorp", title: "Terraform Associate Certification", url: "https://developer.hashicorp.com/terraform/tutorials/certification-003" },
  aws: { provider: "AWS", title: "AWS Certified Solutions Architect – Associate", url: "https://aws.amazon.com/certification/certified-solutions-architect-associate/" },
  "aws lambda": { provider: "AWS", title: "AWS Certified Developer – Associate", url: "https://aws.amazon.com/certification/certified-developer-associate/" },
  gcp: { provider: "Google Cloud", title: "Associate Cloud Engineer", url: "https://cloud.google.com/learn/certification/cloud-engineer" },
  azure: { provider: "Microsoft", title: "Azure Administrator Associate (AZ-104)", url: "https://learn.microsoft.com/credentials/certifications/azure-administrator/" },
  docker: { provider: "Coursera", title: "Containerization with Docker", url: "https://www.coursera.org/learn/docker-basics" },
  react: { provider: "Meta", title: "Meta Front-End Developer Certificate", url: "https://www.coursera.org/professional-certificates/meta-front-end-developer" },
  typescript: { provider: "Frontend Masters", title: "TypeScript Fundamentals", url: "https://frontendmasters.com/courses/typescript-v4/" },
  python: { provider: "Coursera", title: "Python for Everybody", url: "https://www.coursera.org/specializations/python" },
  go: { provider: "Coursera", title: "Programming with Google Go", url: "https://www.coursera.org/specializations/google-golang" },
  golang: { provider: "Coursera", title: "Programming with Google Go", url: "https://www.coursera.org/specializations/google-golang" },
  rust: { provider: "Coursera", title: "Rust Programming", url: "https://www.coursera.org/learn/rust-programming" },
  graphql: { provider: "Apollo", title: "Apollo GraphQL Certification", url: "https://www.apollographql.com/tutorials/" },
  sql: { provider: "Coursera", title: "Modern SQL", url: "https://www.coursera.org/learn/sql-for-data-science" },
  spark: { provider: "Databricks", title: "Apache Spark Developer", url: "https://www.databricks.com/learn/certification/apache-spark-developer-associate" },
  dbt: { provider: "dbt Labs", title: "dbt Analytics Engineering", url: "https://www.getdbt.com/dbt-learn" },
  airflow: { provider: "Astronomer", title: "Apache Airflow Fundamentals", url: "https://academy.astronomer.io/" },
  snowflake: { provider: "Snowflake", title: "SnowPro Core Certification", url: "https://learn.snowflake.com/" },
  "machine learning": { provider: "DeepLearning.AI", title: "Machine Learning Specialization", url: "https://www.coursera.org/specializations/machine-learning-introduction" },
  pytorch: { provider: "DeepLearning.AI", title: "Deep Learning with PyTorch", url: "https://www.coursera.org/learn/deep-neural-networks-with-pytorch" },
  tensorflow: { provider: "DeepLearning.AI", title: "TensorFlow Developer Certificate", url: "https://www.coursera.org/professional-certificates/tensorflow-in-practice" },
  "system design": { provider: "Educative", title: "Grokking the System Design Interview", url: "https://www.educative.io/courses/grokking-the-system-design-interview" },
  kafka: { provider: "Confluent", title: "Apache Kafka Fundamentals", url: "https://developer.confluent.io/courses/" },
  "ci/cd": { provider: "Coursera", title: "CI/CD with Jenkins & GitHub Actions", url: "https://www.coursera.org/learn/continuous-integration" },
}

/** A course for any skill — catalog hit when we have one, else a search CTA. */
export function courseFor(skill: string): CourseSuggestion {
  const label = canonicalizeSkill(skill)
  const hit = COURSE_CATALOG[skillKey(skill)]
  if (hit) return { provider: hit.provider, title: hit.title, url: withTag(hit.url) }
  return {
    provider: "Coursera",
    title: `Courses for ${label}`,
    url: withTag(`https://www.coursera.org/search?query=${encodeURIComponent(label)}`),
  }
}

// ── Engine ─────────────────────────────────────────────────────────────────────

export function computeSkillGaps(jobs: SkillGapJob[], userSkills: string[]): SkillGapResult {
  // Canonicalize the user's skills (alias-aware, noise-filtered) and key them.
  const haveLabels = normalizeSkillList(userSkills)
  const have = new Set(haveLabels.map(normalizeSkillKey))

  // Per missing-skill accumulators.
  type Acc = { display: string; jobs: number; oneAway: number; salaries: number[] }
  const gaps = new Map<string, Acc>()
  const allSalaries: number[] = []
  let eligibleNow = 0

  for (const job of jobs) {
    // Canonical, deduped, noise-filtered posting skills, then gated to genuine
    // learnable skills (taxonomy-known, no generic soft skills) so the gap list
    // never surfaces non-skills or unactionable fluff.
    const skills = actionableSkills(job.requiredSkills)
    // A posting with no recognized hard skills carries no usable signal — don't
    // let it inflate eligibleNow or the target-set math.
    if (skills.length === 0) continue
    const salary = plausibleSalary(job.salary)
    if (salary != null) allSalaries.push(salary)

    // Which canonical skills does the user lack?
    const missing = new Map<string, string>() // key -> canonical label
    for (const label of skills) {
      const k = normalizeSkillKey(label)
      if (k && !have.has(k) && !missing.has(k)) missing.set(k, label)
    }
    if (missing.size === 0) {
      eligibleNow += 1
      continue
    }

    const isOneAway = missing.size === 1
    for (const [key, display] of missing) {
      const acc = gaps.get(key) ?? { display, jobs: 0, oneAway: 0, salaries: [] }
      acc.jobs += 1
      if (isOneAway) acc.oneAway += 1
      if (salary != null) acc.salaries.push(salary)
      gaps.set(key, acc)
    }
  }

  const overallMedian = median(allSalaries)

  const ranked: SkillGap[] = [...gaps.values()]
    .filter((g) => g.jobs >= MIN_JOBS_FOR_GAP)
    .map((g) => {
      const med = median(g.salaries)
      return {
        skill: g.display,
        jobsRequiring: g.jobs,
        oneAway: g.oneAway,
        medianSalary: med,
        salaryUplift: med != null && overallMedian != null ? med - overallMedian : null,
        course: courseFor(g.display),
      }
    })
    // Immediate unlocks first (you're one skill away), then raw demand, then pay.
    .sort((a, b) => {
      if (b.oneAway !== a.oneAway) return b.oneAway - a.oneAway
      if (b.jobsRequiring !== a.jobsRequiring) return b.jobsRequiring - a.jobsRequiring
      return (b.medianSalary ?? 0) - (a.medianSalary ?? 0)
    })
    .slice(0, MAX_GAPS)

  return {
    gaps: ranked,
    targetJobs: jobs.length,
    eligibleNow,
    haveSkills: have.size,
  }
}
