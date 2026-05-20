/**
 * Tech-brand seed list — the most-searched-for tech and consumer-tech
 * employers. Distinct from `enterprise-ats-seeds.ts` (Fortune-1000 /
 * hospitals / universities) because users specifically look for these
 * brands by name and we want them tagged with the right ATS so the
 * harvester picks them up directly.
 *
 * Where I'm confident about the ATS, the careers_url points at the direct
 * ATS endpoint (resolver short-circuits via "already_direct"). Where I'm
 * not sure, it points at the wrapper page and `seed-enterprise-ats.ts`
 * runs the regular probe + headless cascade.
 *
 * Verified API hits (2026-05-19): stripe + anthropic confirmed 200 on
 * boards-api.greenhouse.io. The remaining Greenhouse / Ashby entries are
 * best-guesses based on each company's public board URL.
 */

import type { CompanySize, SeedExtra } from "./company-seeds"

export const TECH_BRAND_SEED_ROWS: ReadonlyArray<
  | readonly [string, string, string, string, CompanySize]
  | readonly [string, string, string, string, CompanySize, SeedExtra]
> = [
  // ── Greenhouse-hosted (verified or near-certain) ─────────────────────────
  ["Stripe", "stripe.com", "https://boards.greenhouse.io/stripe", "Technology", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 92 }],
  ["Anthropic", "anthropic.com", "https://boards.greenhouse.io/anthropic", "Artificial Intelligence", "large", { sponsors_h1b: true, sponsorship_confidence: 92 }],
  ["Coinbase", "coinbase.com", "https://boards.greenhouse.io/coinbase", "Finance", "large", { sponsors_h1b: true, sponsorship_confidence: 85 }],
  ["DoorDash", "doordash.com", "https://boards.greenhouse.io/doordash", "Technology", "large", { sponsors_h1b: true, sponsorship_confidence: 82 }],
  ["Pinterest", "pinterest.com", "https://boards.greenhouse.io/pinterest", "Technology", "large", { sponsors_h1b: true, sponsorship_confidence: 80 }],
  ["Plaid", "plaid.com", "https://boards.greenhouse.io/plaid", "Finance", "large", { sponsors_h1b: true, sponsorship_confidence: 85 }],
  ["Instacart", "instacart.com", "https://boards.greenhouse.io/instacart", "Technology", "large", { sponsors_h1b: true, sponsorship_confidence: 78 }],
  ["Robinhood", "robinhood.com", "https://boards.greenhouse.io/robinhood", "Finance", "large", { sponsors_h1b: true, sponsorship_confidence: 82 }],
  ["Affirm", "affirm.com", "https://boards.greenhouse.io/affirm", "Finance", "large", { sponsors_h1b: true, sponsorship_confidence: 80 }],
  ["Brex", "brex.com", "https://boards.greenhouse.io/brex", "Finance", "large", { sponsors_h1b: true, sponsorship_confidence: 82 }],
  ["Ramp", "ramp.com", "https://boards.greenhouse.io/ramp", "Finance", "medium", { sponsors_h1b: true, sponsorship_confidence: 85 }],
  ["Mercury", "mercury.com", "https://boards.greenhouse.io/mercury", "Finance", "medium", { sponsors_h1b: true, sponsorship_confidence: 80 }],
  ["Retool", "retool.com", "https://boards.greenhouse.io/retool", "Technology", "medium", { sponsors_h1b: true, sponsorship_confidence: 80 }],
  ["Vercel", "vercel.com", "https://boards.greenhouse.io/vercel", "Technology", "medium", { sponsors_h1b: true, sponsorship_confidence: 82 }],
  ["Discord", "discord.com", "https://boards.greenhouse.io/discord", "Technology", "large", { sponsors_h1b: true, sponsorship_confidence: 78 }],
  ["Roblox", "roblox.com", "https://boards.greenhouse.io/roblox", "Technology", "large", { sponsors_h1b: true, sponsorship_confidence: 78 }],
  ["Klarna", "klarna.com", "https://boards.greenhouse.io/klarna", "Finance", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 78 }],
  ["Revolut", "revolut.com", "https://boards.greenhouse.io/revolut", "Finance", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 75 }],
  ["GitHub", "github.com", "https://boards.greenhouse.io/github", "Technology", "large", { sponsors_h1b: true, sponsorship_confidence: 88 }],
  ["GitLab", "gitlab.com", "https://boards.greenhouse.io/gitlab", "Technology", "large", { sponsors_h1b: true, sponsorship_confidence: 80 }],
  ["HashiCorp", "hashicorp.com", "https://boards.greenhouse.io/hashicorp", "Technology", "large", { sponsors_h1b: true, sponsorship_confidence: 82 }],
  ["Webflow", "webflow.com", "https://boards.greenhouse.io/webflow", "Technology", "medium", { sponsors_h1b: true, sponsorship_confidence: 78 }],
  ["Patreon", "patreon.com", "https://boards.greenhouse.io/patreon", "Technology", "medium", { sponsors_h1b: true, sponsorship_confidence: 72 }],
  ["Lyft", "lyft.com", "https://boards.greenhouse.io/lyft", "Technology", "large", { sponsors_h1b: true, sponsorship_confidence: 80 }],
  ["Twitch", "twitch.tv", "https://boards.greenhouse.io/twitch", "Technology", "large", { sponsors_h1b: true, sponsorship_confidence: 78 }],
  ["Squarespace", "squarespace.com", "https://boards.greenhouse.io/squarespace", "Technology", "large", { sponsors_h1b: true, sponsorship_confidence: 75 }],

  // ── Ashby-hosted ─────────────────────────────────────────────────────────
  ["Linear", "linear.app", "https://jobs.ashbyhq.com/linear", "Technology", "medium", { sponsors_h1b: true, sponsorship_confidence: 82 }],
  ["Replicate", "replicate.com", "https://jobs.ashbyhq.com/replicate", "Artificial Intelligence", "startup", { sponsors_h1b: true, sponsorship_confidence: 78 }],
  ["Modal", "modal.com", "https://jobs.ashbyhq.com/modal", "Technology", "startup", { sponsors_h1b: true, sponsorship_confidence: 80 }],
  ["Mistral AI", "mistral.ai", "https://jobs.ashbyhq.com/mistralai", "Artificial Intelligence", "startup", { sponsors_h1b: true, sponsorship_confidence: 75 }],
  ["Hugging Face", "huggingface.co", "https://jobs.ashbyhq.com/huggingface", "Artificial Intelligence", "medium", { sponsors_h1b: true, sponsorship_confidence: 82 }],
  ["Replit", "replit.com", "https://jobs.ashbyhq.com/replit", "Technology", "medium", { sponsors_h1b: true, sponsorship_confidence: 80 }],
  ["xAI", "x.ai", "https://jobs.ashbyhq.com/xai", "Artificial Intelligence", "startup", { sponsors_h1b: true, sponsorship_confidence: 78 }],
  ["Together AI", "together.ai", "https://jobs.ashbyhq.com/togetherai", "Artificial Intelligence", "startup", { sponsors_h1b: true, sponsorship_confidence: 78 }],
  ["Runway", "runwayml.com", "https://jobs.ashbyhq.com/runway", "Artificial Intelligence", "medium", { sponsors_h1b: true, sponsorship_confidence: 80 }],
  ["Scale AI", "scale.com", "https://jobs.ashbyhq.com/scaleai", "Artificial Intelligence", "large", { sponsors_h1b: true, sponsorship_confidence: 82 }],

  // ── Lever-hosted ─────────────────────────────────────────────────────────
  ["Anduril Industries", "anduril.com", "https://jobs.lever.co/anduril", "Aerospace", "large", { sponsors_h1b: true, sponsorship_confidence: 65 }],
  ["Substack", "substack.com", "https://jobs.lever.co/substack", "Technology", "small", { sponsors_h1b: true, sponsorship_confidence: 72 }],
  ["Toast", "toasttab.com", "https://jobs.lever.co/toast", "Technology", "large", { sponsors_h1b: true, sponsorship_confidence: 72 }],

  // ── Wrapper pages (let resolver/headless figure it out) ──────────────────
  ["Airbnb", "airbnb.com", "https://careers.airbnb.com", "Technology", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 88 }],
  ["Uber", "uber.com", "https://www.uber.com/us/en/careers/", "Technology", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 85 }],
  ["Square / Block", "block.xyz", "https://block.xyz/careers", "Finance", "large", { sponsors_h1b: true, sponsorship_confidence: 80 }],
  ["Cash App", "cash.app", "https://cash.app/careers", "Finance", "large", { sponsors_h1b: true, sponsorship_confidence: 80 }],
]
