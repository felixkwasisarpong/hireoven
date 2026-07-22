/**
 * Server-side store for admin-managed social proof (testimonials + partners).
 * Public getters return only published rows mapped to the client view shapes;
 * the admin list functions return the full rows for the management UI.
 */

import type { Pool } from "pg"
import { getPostgresPool, hasPostgresEnv } from "@/lib/postgres/server"
import type { Testimonial, Partner } from "@/lib/marketing/social-proof"

export interface TestimonialRow {
  id: string
  quote: string
  name: string
  role: string
  org: string | null
  avatar_url: string | null
  is_published: boolean
  sort_order: number
  created_at: string
  updated_at: string
}

export interface PartnerRow {
  id: string
  name: string
  logo_url: string | null
  url: string | null
  is_published: boolean
  sort_order: number
  created_at: string
  updated_at: string
}

// ── Public (published only) ────────────────────────────────────────────────

/** Published testimonials for the public /partners page. Empty on any error. */
export async function getPublishedTestimonials(poolArg?: Pool): Promise<Testimonial[]> {
  if (!hasPostgresEnv()) return []
  const pool = poolArg ?? getPostgresPool()
  try {
    const { rows } = await pool.query<TestimonialRow>(
      `SELECT quote, name, role, org, avatar_url
         FROM testimonials
        WHERE is_published = true
        ORDER BY sort_order ASC, created_at DESC`,
    )
    return rows.map((r) => ({
      quote: r.quote,
      name: r.name,
      role: r.role,
      org: r.org,
      avatarUrl: r.avatar_url,
    }))
  } catch {
    return []
  }
}

/** Published partners for the public /partners page. Empty on any error. */
export async function getPublishedPartners(poolArg?: Pool): Promise<Partner[]> {
  if (!hasPostgresEnv()) return []
  const pool = poolArg ?? getPostgresPool()
  try {
    const { rows } = await pool.query<PartnerRow>(
      `SELECT name, logo_url, url
         FROM partners
        WHERE is_published = true
        ORDER BY sort_order ASC, created_at DESC`,
    )
    return rows.map((r) => ({ name: r.name, logoUrl: r.logo_url, url: r.url }))
  } catch {
    return []
  }
}

// ── Admin (all rows) ───────────────────────────────────────────────────────

export async function listAllTestimonials(poolArg?: Pool): Promise<TestimonialRow[]> {
  const pool = poolArg ?? getPostgresPool()
  const { rows } = await pool.query<TestimonialRow>(
    `SELECT * FROM testimonials ORDER BY sort_order ASC, created_at DESC`,
  )
  return rows
}

export async function listAllPartners(poolArg?: Pool): Promise<PartnerRow[]> {
  const pool = poolArg ?? getPostgresPool()
  const { rows } = await pool.query<PartnerRow>(
    `SELECT * FROM partners ORDER BY sort_order ASC, created_at DESC`,
  )
  return rows
}
