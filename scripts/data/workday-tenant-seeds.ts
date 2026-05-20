/**
 * Candidate Workday tenant list — companies/organizations that are widely
 * believed to run on Workday but may not yet have an `*.{wdN}.myworkdayjobs.com`
 * entry in our companies table.
 *
 * Each row is `[displayName, tenantSlug, domain, industry, size, extras?]`.
 * The seed script enumerates Workday clusters (wd1..wd108) for each slug and
 * takes the first one whose `resolveWorkdaySite` returns a site. Slugs that
 * resolve nowhere are skipped — Workday issues per-cluster wildcard certs, so
 * crt.sh can't help us, and we'd rather miss than poison the table.
 *
 * Avoids the 388 tenant slugs already in the DB (as of 2026-05-19). If you
 * want to fill in coverage, target categories that historically use Workday
 * for staff hiring even when their public brand sits on a wrapper:
 *   - State / public universities (HR runs on Workday almost universally)
 *   - Regional / nonprofit health systems
 *   - Federal-adjacent professional services
 *   - Tech mid-caps that don't show a Workday link in static HTML
 */

import type { CompanySize, SeedExtra } from "./company-seeds"

export const WORKDAY_CANDIDATE_TENANTS: ReadonlyArray<
  | readonly [string, string, string, string, CompanySize]
  | readonly [string, string, string, string, CompanySize, SeedExtra]
> = [
  // ── Tech: mid-large companies where Workday is plausible but the wrapper hides it ──
  ["Snowflake", "snowflake", "snowflake.com", "Technology", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 90 }],
  ["Splunk", "splunk", "splunk.com", "Technology", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 85 }],
  ["ServiceNow", "servicenow", "servicenow.com", "Technology", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 88 }],
  ["Atlassian", "atlassian", "atlassian.com", "Technology", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 85 }],
  ["Datadog", "datadog", "datadoghq.com", "Technology", "large", { sponsors_h1b: true, sponsorship_confidence: 85 }],
  ["MongoDB", "mongodb", "mongodb.com", "Technology", "large", { sponsors_h1b: true, sponsorship_confidence: 82 }],
  ["Twilio", "twilio", "twilio.com", "Technology", "large", { sponsors_h1b: true, sponsorship_confidence: 82 }],
  ["Workday", "workdayinc", "workday.com", "Technology", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 88 }],
  ["Box", "box", "box.com", "Technology", "large", { sponsors_h1b: true, sponsorship_confidence: 78 }],
  ["Dropbox", "dropbox", "dropbox.com", "Technology", "large", { sponsors_h1b: true, sponsorship_confidence: 80 }],
  ["Slack Salesforce", "slack", "slack.com", "Technology", "large", { sponsors_h1b: true, sponsorship_confidence: 80 }],
  ["Asana", "asana", "asana.com", "Technology", "large", { sponsors_h1b: true, sponsorship_confidence: 80 }],
  ["Pure Storage", "purestorage", "purestorage.com", "Technology", "large", { sponsors_h1b: true, sponsorship_confidence: 80 }],
  ["NetApp", "netapp", "netapp.com", "Technology", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 80 }],
  ["Verisign", "verisign", "verisign.com", "Technology", "large", { sponsors_h1b: true, sponsorship_confidence: 75 }],

  // ── Financial services / insurance ────────────────────────────────────────
  ["Morgan Stanley", "morganstanley", "morganstanley.com", "Finance", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 85 }],
  ["Goldman Sachs", "goldmansachs", "goldmansachs.com", "Finance", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 85 }],
  ["BlackRock", "blackrock", "blackrock.com", "Finance", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 85 }],
  ["Invesco", "invesco", "invesco.com", "Finance", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 75 }],
  ["Franklin Templeton", "franklintempleton", "franklintempleton.com", "Finance", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 75 }],
  ["KKR", "kkr", "kkr.com", "Finance", "large", { sponsors_h1b: true, sponsorship_confidence: 80 }],
  ["Apollo Global", "apolloglobal", "apollo.com", "Finance", "large", { sponsors_h1b: true, sponsorship_confidence: 80 }],
  ["Carlyle Group", "carlyle", "carlyle.com", "Finance", "large", { sponsors_h1b: true, sponsorship_confidence: 78 }],
  ["Lazard", "lazard", "lazard.com", "Finance", "large", { sponsors_h1b: true, sponsorship_confidence: 78 }],
  ["Raymond James", "rjf", "raymondjames.com", "Finance", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 70 }],
  ["Voya Financial", "voya", "voya.com", "Finance", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 72 }],
  ["Lincoln Financial", "lincolnfinancial", "lfg.com", "Finance", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 70 }],
  ["Principal Financial", "principal", "principal.com", "Finance", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 75 }],
  ["Erie Insurance", "erieinsurance", "erieinsurance.com", "Finance", "enterprise", { sponsors_h1b: false, sponsorship_confidence: 45 }],
  ["Nationwide", "nationwide", "nationwide.com", "Finance", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 65 }],
  ["State Farm", "statefarm", "statefarm.com", "Finance", "enterprise", { sponsors_h1b: false, sponsorship_confidence: 50 }],
  ["Discover Financial", "discover", "discover.com", "Finance", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 75 }],

  // ── Hospitals / health systems (Workday HCM is dominant for staff hiring) ─
  ["UnitedHealth Group", "unitedhealthgroup", "unitedhealthgroup.com", "Healthcare", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 65 }],
  ["Optum", "optum", "optum.com", "Healthcare", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 65 }],
  ["Mass General Brigham", "mghpcc", "massgeneralbrigham.org", "Healthcare", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 70 }],
  ["Providence Health", "providence", "providence.org", "Healthcare", "enterprise", { sponsors_h1b: false, sponsorship_confidence: 45 }],
  ["Sutter Health", "sutterhealth", "sutterhealth.org", "Healthcare", "enterprise", { sponsors_h1b: false, sponsorship_confidence: 50 }],
  ["Dignity Health", "dignityhealth", "dignityhealth.org", "Healthcare", "enterprise", { sponsors_h1b: false, sponsorship_confidence: 45 }],
  ["Henry Ford Health", "hfhs", "henryford.com", "Healthcare", "enterprise", { sponsors_h1b: false, sponsorship_confidence: 50 }],
  ["Spectrum Health", "corewellhealth", "corewellhealth.org", "Healthcare", "enterprise", { sponsors_h1b: false, sponsorship_confidence: 45 }],
  ["Bon Secours Mercy Health", "mercy", "mercy.com", "Healthcare", "enterprise", { sponsors_h1b: false, sponsorship_confidence: 40 }],
  ["IU Health", "iuhealth", "iuhealth.org", "Healthcare", "large", { sponsors_h1b: false, sponsorship_confidence: 50 }],
  ["Atrium Health", "atriumhealth", "atriumhealth.org", "Healthcare", "enterprise", { sponsors_h1b: false, sponsorship_confidence: 45 }],
  ["Centene", "centene", "centene.com", "Healthcare", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 65 }],
  ["Molina Healthcare", "molina", "molinahealthcare.com", "Healthcare", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 60 }],
  ["Anthem Inc", "anthem", "anthem.com", "Healthcare", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 70 }],

  // ── Universities (Workday HCM is the default for staff/faculty hiring) ────
  ["University of Washington", "uw", "washington.edu", "Education", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 70 }],
  ["Cornell University", "cornell", "cornell.edu", "Education", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 70 }],
  ["University of Southern California", "usc", "usc.edu", "Education", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 70 }],
  ["University of Florida", "ufl", "ufl.edu", "Education", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 65 }],
  ["Ohio State University", "osu", "osu.edu", "Education", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 65 }],
  ["Arizona State University", "asu", "asu.edu", "Education", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 65 }],
  ["New York University", "nyu", "nyu.edu", "Education", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 70 }],
  ["Boston University", "bu", "bu.edu", "Education", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 65 }],
  ["University of Virginia", "uva", "virginia.edu", "Education", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 65 }],
  ["University of North Carolina", "unc", "unc.edu", "Education", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 65 }],
  ["University of Wisconsin", "wisc", "wisc.edu", "Education", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 65 }],
  ["University of Maryland", "umd", "umd.edu", "Education", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 65 }],
  ["University of Texas Austin", "utexas", "utexas.edu", "Education", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 65 }],
  ["University of Pittsburgh", "pitt", "pitt.edu", "Education", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 60 }],
  ["Vanderbilt University", "vanderbilt", "vanderbilt.edu", "Education", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 60 }],
  ["Emory University", "emory", "emory.edu", "Education", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 60 }],
  ["Brown University", "brown", "brown.edu", "Education", "large", { sponsors_h1b: true, sponsorship_confidence: 65 }],
  ["Dartmouth College", "dartmouth", "dartmouth.edu", "Education", "large", { sponsors_h1b: true, sponsorship_confidence: 60 }],
  ["Georgia Tech", "gatech", "gatech.edu", "Education", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 70 }],
  ["Purdue University", "purdue", "purdue.edu", "Education", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 65 }],
  ["University of Illinois", "uillinois", "illinois.edu", "Education", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 65 }],
  ["University of Minnesota", "umn", "umn.edu", "Education", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 65 }],
  ["Rutgers University", "rutgers", "rutgers.edu", "Education", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 60 }],

  // ── State / local government (lots of Workday HCM deployments) ────────────
  ["State of California", "ca", "ca.gov", "Government", "enterprise", { sponsors_h1b: false, sponsorship_confidence: 30 }],
  ["State of New York", "ny", "ny.gov", "Government", "enterprise", { sponsors_h1b: false, sponsorship_confidence: 30 }],
  ["State of Texas", "texas", "texas.gov", "Government", "enterprise", { sponsors_h1b: false, sponsorship_confidence: 30 }],
  ["City of New York", "nyc", "nyc.gov", "Government", "enterprise", { sponsors_h1b: false, sponsorship_confidence: 30 }],
  ["State of Washington", "wa", "wa.gov", "Government", "enterprise", { sponsors_h1b: false, sponsorship_confidence: 30 }],

  // ── Retail / hospitality / consumer ───────────────────────────────────────
  ["McDonald's", "mcdonalds", "mcdonalds.com", "Retail", "enterprise", { sponsors_h1b: false, sponsorship_confidence: 45 }],
  ["Starbucks", "starbucks", "starbucks.com", "Retail", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 60 }],
  ["Yum! Brands", "yumbrands", "yum.com", "Retail", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 60 }],
  ["Chipotle Mexican Grill", "chipotle2", "chipotle.com", "Retail", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 55 }],
  ["Domino's Pizza", "dominos", "dominos.com", "Retail", "enterprise", { sponsors_h1b: false, sponsorship_confidence: 45 }],
  ["Restaurant Brands", "rbi", "rbi.com", "Retail", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 60 }],
  ["Darden Restaurants", "darden", "darden.com", "Retail", "enterprise", { sponsors_h1b: false, sponsorship_confidence: 45 }],
  ["Wendy's", "wendys", "wendys.com", "Retail", "enterprise", { sponsors_h1b: false, sponsorship_confidence: 45 }],
  ["Dollar General", "dollargeneral", "dollargeneral.com", "Retail", "enterprise", { sponsors_h1b: false, sponsorship_confidence: 40 }],
  ["Dollar Tree", "dollartree", "dollartree.com", "Retail", "enterprise", { sponsors_h1b: false, sponsorship_confidence: 40 }],
  ["Ross Stores", "rossstores", "rossstores.com", "Retail", "enterprise", { sponsors_h1b: false, sponsorship_confidence: 45 }],
  ["TJX Companies", "tjx", "tjx.com", "Retail", "enterprise", { sponsors_h1b: false, sponsorship_confidence: 45 }],
  ["Ulta Beauty", "ulta", "ulta.com", "Retail", "enterprise", { sponsors_h1b: false, sponsorship_confidence: 50 }],
  ["Sephora", "sephora", "sephora.com", "Retail", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 60 }],
  ["AutoZone", "autozone", "autozone.com", "Retail", "enterprise", { sponsors_h1b: false, sponsorship_confidence: 45 }],
  ["O'Reilly Auto Parts", "oreillyauto2", "oreillyauto.com", "Retail", "enterprise", { sponsors_h1b: false, sponsorship_confidence: 45 }],

  // ── CPG / Industrial / Misc ───────────────────────────────────────────────
  ["Clorox", "clorox", "thecloroxcompany.com", "Consumer Goods", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 70 }],
  ["Kimberly-Clark", "kimberlyclark", "kimberly-clark.com", "Consumer Goods", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 72 }],
  ["Church & Dwight", "churchdwight2", "churchdwight.com", "Consumer Goods", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 68 }],
  ["Hershey", "hershey", "hersheys.com", "Consumer Goods", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 65 }],
  ["Tractor Supply", "tractorsupply", "tractorsupply.com", "Retail", "enterprise", { sponsors_h1b: false, sponsorship_confidence: 45 }],
  ["AECOM", "aecom", "aecom.com", "Industrial", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 72 }],
  ["Fluor", "fluor", "fluor.com", "Industrial", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 65 }],
  ["Jacobs", "jacobs", "jacobs.com", "Industrial", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 72 }],
  ["WSP Global", "wsp", "wsp.com", "Industrial", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 70 }],
  ["Stantec", "stantec", "stantec.com", "Industrial", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 68 }],
  ["EY", "ey", "ey.com", "Consulting", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 88 }],
  ["KPMG", "kpmg", "kpmg.com", "Consulting", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 88 }],
  ["Deloitte", "deloitte", "deloitte.com", "Consulting", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 92 }],
  ["McKinsey & Company", "mckinsey", "mckinsey.com", "Consulting", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 88 }],
  ["BCG", "bcg", "bcg.com", "Consulting", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 88 }],
  ["Bain & Company", "bain", "bain.com", "Consulting", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 85 }],
  ["Slalom", "slalom", "slalom.com", "Consulting", "large", { sponsors_h1b: true, sponsorship_confidence: 78 }],
  ["West Monroe", "westmonroe", "westmonroe.com", "Consulting", "medium", { sponsors_h1b: true, sponsorship_confidence: 75 }],
  ["Mercer", "mercer", "mercer.com", "Consulting", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 80 }],
  ["Aon", "aon", "aon.com", "Consulting", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 80 }],
  ["Willis Towers Watson", "wtw", "wtwco.com", "Consulting", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 78 }],
  ["FTI Consulting", "fticonsulting", "fticonsulting.com", "Consulting", "large", { sponsors_h1b: true, sponsorship_confidence: 75 }],
  ["Alvarez & Marsal", "alvarezandmarsal", "alvarezandmarsal.com", "Consulting", "large", { sponsors_h1b: true, sponsorship_confidence: 75 }],

  // ── Defense / aerospace adjacent ──────────────────────────────────────────
  ["Booz Allen Hamilton", "bah2", "boozallen.com", "Consulting", "enterprise", { sponsors_h1b: false, sponsorship_confidence: 30 }],
  ["SAIC", "saic", "saic.com", "Consulting", "enterprise", { sponsors_h1b: false, sponsorship_confidence: 30 }],
  ["CACI International", "caci2", "caci.com", "Consulting", "enterprise", { sponsors_h1b: false, sponsorship_confidence: 30 }],
  ["Mantech", "mantech", "mantech.com", "Consulting", "large", { sponsors_h1b: false, sponsorship_confidence: 30 }],
  ["Peraton", "peraton", "peraton.com", "Consulting", "enterprise", { sponsors_h1b: false, sponsorship_confidence: 30 }],
  ["BAE Systems", "baesystems", "baesystems.com", "Aerospace", "enterprise", { sponsors_h1b: false, sponsorship_confidence: 35 }],
]

/**
 * Workday cluster IDs to probe per tenant slug, ordered by observed
 * prevalence in our existing 388-tenant dataset.
 */
export const WORKDAY_CLUSTERS = ["wd1", "wd5", "wd3", "wd12", "wd103", "wd108", "wd2", "wd501", "wd503"] as const
