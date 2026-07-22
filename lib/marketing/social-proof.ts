/**
 * Social proof content for the /partners page — testimonials and partner logos.
 *
 * These arrays ship EMPTY on purpose. The page hides each section until it has
 * real entries, so nothing fabricated is ever published. When you collect a
 * real testimonial or sign a partner, add it here (see the example shapes in
 * the comments) and it appears automatically.
 *
 * Pure data module — safe to import from client components.
 */

export interface Testimonial {
  /** The quote, in the person's own words. */
  quote: string
  /** Real person's name. */
  name: string
  /** Their role / title. */
  role: string
  /** Their organization, if any. */
  org?: string
  /** Optional avatar image URL (absolute or /public path). */
  avatarUrl?: string
}

export interface Partner {
  /** Organization name. */
  name: string
  /** Optional logo URL (absolute or /public path). */
  logoUrl?: string
  /** Optional link to the partner's site or their co-branded HireOven page. */
  url?: string
}

/**
 * Real testimonials only. Example shape (do NOT ship placeholder quotes — a
 * fabricated review is worse than an empty section):
 *
 *   {
 *     quote: "Our international students found sponsor-friendly roles in days, not months.",
 *     name: "Jane Doe",
 *     role: "Director, Career Services",
 *     org: "State University",
 *     avatarUrl: "/testimonials/jane-doe.jpg",
 *   }
 */
export const TESTIMONIALS: Testimonial[] = []

/**
 * Signed / active partners. Example shape:
 *
 *   { name: "State University Career Center", logoUrl: "/partners/state-u.png", url: "https://…" }
 */
export const PARTNERS: Partner[] = []
