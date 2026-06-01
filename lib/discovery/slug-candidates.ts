/**
 * Company-name → ATS slug candidates.
 *
 * Most slug-based ATSes (Greenhouse, Lever, Ashby, SmartRecruiters, Workable,
 * BambooHR) host a tenant at a slug derived from the company name. The probe
 * cron and the discover-*-tenants scripts both generate the same candidate set
 * from a name, then check each against the ATS API.
 *
 * Extracted from the original probe scripts so the cron and scripts stay in
 * lockstep. Pure + dependency-free for easy unit testing.
 */

// Legal/marketing tokens stripped before slugifying — same set the lever/
// greenhouse probes use, so name→slug stays consistent across channels.
const NAME_NOISE_RE =
  /\b(incorporated|inc|l\.?l\.?c\.?|llp|corp|corporation|ltd|limited|co|company|plc|holdings|group|technologies|technology|solutions|services|systems|us|usa|america|americas)\b/gi

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "")
}

function slugifyHyphen(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

/**
 * Ordered, de-duplicated slug candidates for a company name. Most-likely first
 * (cleaned compact form), so callers that stop on the first API hit do the
 * least work. Returns [] for names that can't yield a usable slug.
 */
export function generateSlugCandidates(name: string): string[] {
  const variants = new Set<string>()
  const cleaned = name
    .replace(NAME_NOISE_RE, " ")
    .replace(/[,()&]/g, " ")
    .trim()

  variants.add(slugify(cleaned))
  variants.add(slugifyHyphen(cleaned))
  const firstWord = cleaned.split(/\s+/)[0]
  if (firstWord) variants.add(slugify(firstWord))
  variants.add(slugify(name))

  return Array.from(variants).filter((s) => s.length >= 2 && s.length <= 60)
}
