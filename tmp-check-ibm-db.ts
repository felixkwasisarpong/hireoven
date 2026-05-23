import { getPostgresPool } from "@/lib/postgres/server"

async function run() {
  const pool = getPostgresPool()

  const companies = await pool.query(
    `select id, name, domain, careers_url, direct_ats_url, ats_type, ats_identifier,
            status, is_active, freshness_tier, last_crawled_at, next_harvest_at
       from companies
      where lower(name) like '%ibm%'
         or lower(domain) like '%ibm%'
      order by is_active desc, status asc, name asc
      limit 20`
  )

  const ids: string[] = companies.rows.map((r: any) => r.id)

  const jobCounts = ids.length
    ? await pool.query(
        `select company_id, count(*)::int as total_jobs
           from jobs
          where company_id = any($1::uuid[])
          group by company_id`,
        [ids]
      )
    : { rows: [] as any[] }

  const countsById = new Map(jobCounts.rows.map((r: any) => [r.company_id, r.total_jobs]))

  const result: any[] = []
  for (const row of companies.rows as any[]) {
    const logs = await pool.query(
      `select status, jobs_found, new_jobs, crawled_at, error_message
         from crawl_logs
        where company_id = $1
        order by crawled_at desc
        limit 5`,
      [row.id]
    )

    result.push({
      ...row,
      total_jobs: countsById.get(row.id) ?? 0,
      recent_logs: logs.rows,
    })
  }

  console.log(JSON.stringify(result, null, 2))
  await pool.end()
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
