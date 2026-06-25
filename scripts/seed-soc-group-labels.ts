/**
 * Seed soc_group_labels (human-readable role names for 4-digit SOC groups).
 * Curated from the top SOC groups in certified LCA filings.
 *
 * Usage: npx tsx scripts/seed-soc-group-labels.ts
 */
import { loadEnvConfig } from "@next/env"
loadEnvConfig(process.cwd())
import { getPostgresPool } from "@/lib/postgres/server"

type Label = [soc: string, label: string, short: string, slug: string, family: string, featured: boolean]

const LABELS: Label[] = [
  ["15-12", "Software Developers", "Software Dev", "software-developers", "Computer & IT", true],
  ["15-20", "Data Scientists", "Data Scientist", "data-scientists", "Computer & IT", true],
  ["17-21", "Mechanical Engineers", "Mech Engineer", "mechanical-engineers", "Engineering", true],
  ["17-20", "Electrical Engineers", "Elec Engineer", "electrical-engineers", "Engineering", true],
  ["13-20", "Financial Analysts", "Financial Analyst", "financial-analysts", "Business & Finance", true],
  ["11-30", "Information Systems Managers", "IS Manager", "information-systems-managers", "Management", true],
  ["13-11", "Management Analysts", "Mgmt Analyst", "management-analysts", "Business & Finance", true],
  ["29-12", "Physicians", "Physician", "physicians", "Healthcare", true],
  ["19-10", "Medical Scientists", "Medical Scientist", "medical-scientists", "Science", true],
  ["13-10", "Project Management Specialists", "Project Manager", "project-management-specialists", "Business & Finance", true],
  ["11-90", "Engineering Managers", "Eng Manager", "engineering-managers", "Management", true],
  ["19-20", "Chemists", "Chemist", "chemists", "Science", true],
  ["11-20", "Marketing Managers", "Marketing Mgr", "marketing-managers", "Management", true],
  ["41-90", "Sales Engineers", "Sales Engineer", "sales-engineers", "Sales", true],
  ["23-10", "Lawyers", "Lawyer", "lawyers", "Legal", true],
  ["25-10", "Postsecondary Teachers", "Professor", "postsecondary-teachers", "Education", false],
  ["25-20", "Elementary School Teachers", "Elem Teacher", "elementary-school-teachers", "Education", false],
  ["29-11", "Physical Therapists", "Physical Therapist", "physical-therapists", "Healthcare", false],
  ["27-10", "Graphic Designers", "Designer", "graphic-designers", "Arts & Design", false],
  ["11-10", "Operations Managers", "Ops Manager", "operations-managers", "Management", false],
  ["29-20", "Clinical Lab Technologists", "Lab Tech", "clinical-lab-technologists", "Healthcare", false],
  ["17-10", "Architects", "Architect", "architects", "Engineering", false],
  ["21-10", "Counselors", "Counselor", "counselors", "Community & Social", false],
  ["19-30", "Economists", "Economist", "economists", "Science", false],
  ["29-10", "Dentists", "Dentist", "dentists", "Healthcare", false],
  ["11-91", "Health Services Managers", "Health Svc Mgr", "health-services-managers", "Management", false],
  ["27-30", "Public Relations Specialists", "PR Specialist", "public-relations-specialists", "Media", false],
  ["19-40", "Biological Technicians", "Bio Tech", "biological-technicians", "Science", false],
  ["15-11", "Computer Programmers", "Programmer", "computer-programmers", "Computer & IT", false],
  ["17-30", "Drafters & Technicians", "Drafter", "drafters", "Engineering", false],
]

async function main() {
  const pool = getPostgresPool()
  const params: unknown[] = []
  const tuples = LABELS.map((l) => {
    const b = params.length
    params.push(...l)
    return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6})`
  })
  await pool.query(
    `INSERT INTO soc_group_labels (soc_group, label, short_label, slug, family, is_featured)
     VALUES ${tuples.join(",")}
     ON CONFLICT (soc_group) DO UPDATE SET
       label = EXCLUDED.label, short_label = EXCLUDED.short_label,
       slug = EXCLUDED.slug, family = EXCLUDED.family, is_featured = EXCLUDED.is_featured`,
    params
  )
  const { rows } = await pool.query<{ n: string; f: string }>(
    "SELECT COUNT(*)::text n, COUNT(*) FILTER (WHERE is_featured)::text f FROM soc_group_labels"
  )
  console.log(`seeded ${rows[0].n} soc_group_labels (${rows[0].f} featured)`)
  await pool.end()
}
main().catch((e) => { console.error(e); process.exit(1) })
