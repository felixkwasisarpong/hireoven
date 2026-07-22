/**
 * Social proof types for the /partners page — testimonials and partner logos.
 *
 * Content is admin-managed (see /admin/testimonials); the DB rows live in
 * lib/marketing/social-proof-store.ts. This module holds only the public,
 * client-safe view shapes.
 */

export interface Testimonial {
  quote: string
  name: string
  role: string
  org?: string | null
  avatarUrl?: string | null
}

export interface Partner {
  name: string
  logoUrl?: string | null
  url?: string | null
}
