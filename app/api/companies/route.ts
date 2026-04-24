import { NextRequest, NextResponse } from "next/server"
import { getPostgresPool } from "@/lib/postgres/server"

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const industry = searchParams.get("industry")
  const size = searchParams.get("size")
  const atsType = searchParams.get("ats_type")
  const sponsorsH1b = searchParams.get("sponsors_h1b")
  const hasJobs = searchParams.get("has_jobs")
  const sort = searchParams.get("sort") ?? "job_count"
  const limit = Math.min(100, parseInt(searchParams.get("limit") ?? "24", 10))
  const offset = parseInt(searchParams.get("offset") ?? "0", 10)
  const q = searchParams.get("q")

  const where: string[] = ["is_active = true"]
  const values: Array<string | number | boolean | string[]> = []

  const addParam = (value: string | number | boolean | string[]) => {
    values.push(value)
    return `$${values.length}`
  }

  if (q?.trim()) {
    where.push(`name ILIKE ${addParam(`%${q.trim()}%`)}`)
  }
  if (industry) {
    const industries = industry.split(",").map((s) => s.trim()).filter(Boolean)
    if (industries.length === 1) {
      where.push(`industry = ${addParam(industries[0])}`)
    } else if (industries.length > 1) {
      where.push(`industry = ANY(${addParam(industries)}::text[])`)
    }
  }
  if (size) {
    const sizes = size.split(",").map((s) => s.trim()).filter(Boolean)
    if (sizes.length === 1) {
      where.push(`size = ${addParam(sizes[0])}`)
    } else if (sizes.length > 1) {
      where.push(`size = ANY(${addParam(sizes)}::text[])`)
    }
  }
  if (atsType) where.push(`ats_type = ${addParam(atsType)}`)
  if (sponsorsH1b === "true") where.push("sponsors_h1b = true")
  if (hasJobs === "true") where.push("job_count > 0")

  const sortMap: Record<string, { col: string; asc: boolean }> = {
    job_count: { col: "job_count", asc: false },
    sponsorship_confidence: { col: "sponsorship_confidence", asc: false },
    created_at: { col: "created_at", asc: false },
    name: { col: "name", asc: true },
    h1b_sponsor_count_1yr: { col: "h1b_sponsor_count_1yr", asc: false },
  }
  const { col, asc } = sortMap[sort] ?? sortMap.job_count

  const pool = getPostgresPool()

  try {
    const limitParam = addParam(limit)
    const offsetParam = addParam(offset)

    const result = await pool.query<Record<string, unknown> & { total_count: string }>(
      `SELECT companies.*, COUNT(*) OVER()::text AS total_count
       FROM companies
       WHERE ${where.join(" AND ")}
       ORDER BY ${col} ${asc ? "ASC" : "DESC"}
       LIMIT ${limitParam}
       OFFSET ${offsetParam}`,
      values
    )

    const total = Number(result.rows[0]?.total_count ?? 0)
    const companies = result.rows.map(({ total_count: _ignore, ...row }) => row)

    return NextResponse.json({ companies, total })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Database query failed" },
      { status: 500 }
    )
  }
}
