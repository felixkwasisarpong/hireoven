import { writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { normalizeCrawlerJobForPersistence } from "@/lib/jobs/normalization"

type ExampleInput = {
  id: string
  note: string
  rawJob: {
    externalId?: string
    title: string
    url: string
    description?: string
    location?: string
    postedAt?: string
  }
}

const crawledAtIso = "2026-04-22T09:40:00.000Z"

const examples: ExampleInput[] = [
  {
    id: "greenhouse_structured_like",
    note: "Structured-style ATS input with clear headings and compensation.",
    rawJob: {
      externalId: "greenhouse:7729183",
      title: "Senior Software Engineer, Platform",
      url: "https://boards.greenhouse.io/example/jobs/7729183",
      location: "San Jose, CA",
      postedAt: "2026-04-20T13:22:19.000Z",
      description: `
About the role:
You will build platform capabilities that power job ingestion and ranking.

Responsibilities:
- Build resilient APIs and async workflows
- Collaborate with product, design, and data teams
- Mentor engineers and improve engineering standards

Minimum qualifications:
- 5+ years of backend software engineering experience
- Strong TypeScript or Node.js experience
- Solid SQL and distributed systems fundamentals

Preferred qualifications:
- Experience with event-driven systems and Kafka
- Experience with Rust or Go

Compensation:
$165k - $220k per year

Benefits:
Health, dental, vision, 401(k), paid time off, parental leave

Work authorization:
Visa sponsorship available for qualified candidates.
`,
    },
  },
  {
    id: "workday_blob",
    note: "Single large description blob, mixed section labels, partial structure.",
    rawJob: {
      externalId: "workday:careers:job_91",
      title: "Software Development Engineer III",
      url: "https://example.wd1.myworkdayjobs.com/en-US/careers/job/Software-Development-Engineer-III_R-91",
      location: "Burlington, NC",
      postedAt: "2 days ago",
      description:
        "Overview We are looking for an engineer who can own end to end platform work. What you'll do - Design and ship backend services - Improve reliability and observability - Partner with cross-functional stakeholders Required qualifications - 6+ years experience in software engineering - Experience with distributed systems Preferred qualifications - Cloud platform exposure and Kubernetes knowledge Benefits include medical, dental, vision, retirement, and generous PTO. Compensation range USD 140000 to 195000 annually. This role may require candidates to be authorized to work in the United States without sponsorship.",
    },
  },
  {
    id: "generic_html_like",
    note: "Generic crawl source with noisy HTML-like content and minimal metadata.",
    rawJob: {
      externalId: "url:a9012c6d3f-example",
      title: "Backend Engineer",
      url: "https://careers.example.com/jobs/backend-engineer",
      location: "Remote - United States",
      description: `
<div>
  <h2>What You Will Do</h2>
  <ul>
    <li>Build internal services used by recruiting and analytics teams</li>
    <li>Partner with product managers to scope and deliver features</li>
  </ul>
  <h2>Requirements</h2>
  <ul>
    <li>4+ years of software engineering experience</li>
    <li>Experience with Postgres and API design</li>
  </ul>
  <h2>About Us</h2>
  <p>We are a mission-driven company helping job seekers discover roles faster.</p>
</div>
      `,
    },
  },
]

async function main() {
  const outputs = examples.map((example) => {
    const normalized = normalizeCrawlerJobForPersistence({
      rawJob: example.rawJob,
      crawledAtIso,
    })

    return {
      id: example.id,
      note: example.note,
      raw: example.rawJob,
      normalized: {
        nextColumns: normalized.nextColumns,
        canonical: normalized.canonical,
        pageView: normalized.pageView,
        cardView: normalized.cardView,
      },
    }
  })

  const outputPath = resolve(process.cwd(), "scripts/output/job-normalization-examples.json")
  await writeFile(
    outputPath,
    JSON.stringify({ generated_at: new Date().toISOString(), outputs }, null, 2)
  )
  console.log(`Wrote ${outputs.length} examples to ${outputPath}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
