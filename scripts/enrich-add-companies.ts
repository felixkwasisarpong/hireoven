/**
 * Expand the companies table to a target count by creating new companies from
 * the top unmatched H1B/USCIS employer records.
 *
 * Strategy:
 *  1. Pull top unmatched employers from h1b_records (by total approvals).
 *  2. Skip obvious staffing/temp firms and employers already matched.
 *  3. Use a hardcoded domain + careers_url override table for accuracy on
 *     well-known companies; fall back to guessPublicDomain() for the rest.
 *  4. Insert as active companies with Clearbit logo + LinkedIn careers fallback.
 *  5. Immediately link h1b_records.company_id and compute sponsorship fields.
 *
 * Usage:
 *   npx tsx scripts/enrich-add-companies.ts                   # dry run
 *   npx tsx scripts/enrich-add-companies.ts --execute         # write to DB
 *   npx tsx scripts/enrich-add-companies.ts --execute --target=1500
 *   npx tsx scripts/enrich-add-companies.ts --execute --min-approvals=5
 */

import { loadEnvConfig } from "@next/env"
loadEnvConfig(process.cwd())
import { Pool } from "pg"
import { companyLogoUrlFromDomain } from "../lib/companies/logo-url"

// ─── CLI ─────────────────────────────────────────────────────────────────────

const execute = process.argv.includes("--execute")
const targetArg = process.argv.find((a) => a.startsWith("--target="))
const TARGET = Number(targetArg?.split("=")[1] ?? "1500")
const minApprovalsArg = process.argv.find((a) => a.startsWith("--min-approvals="))
const MIN_APPROVALS = Number(minApprovalsArg?.split("=")[1] ?? "10")

// ─── Domain + careers URL overrides ──────────────────────────────────────────
// Keyed by UPPER-CASE normalized employer name (after stripping legal suffixes).

type Override = { domain: string; careers: string; name?: string; industry?: string }

const OVERRIDES: Record<string, Override> = {
  // Big Tech
  "META PLATFORMS":                     { domain: "meta.com",              careers: "https://www.metacareers.com",                    name: "Meta Platforms",        industry: "Technology" },
  "AMAZON WEB SERVICES":                { domain: "aws.amazon.com",        careers: "https://www.amazon.jobs",                        name: "Amazon Web Services",   industry: "Technology" },
  "ORACLE AMERICA":                     { domain: "oracle.com",            careers: "https://careers.oracle.com",                     name: "Oracle America",        industry: "Technology" },
  "ADVANCED MICRO DEVICES":             { domain: "amd.com",               careers: "https://careers.amd.com",                        name: "AMD",                   industry: "Technology" },
  "VMWARE":                             { domain: "vmware.com",            careers: "https://careers.vmware.com",                     name: "VMware",                industry: "Technology" },
  "SAP AMERICA":                        { domain: "sap.com",               careers: "https://jobs.sap.com",                           name: "SAP",                   industry: "Technology" },
  "THE MATHWORKS":                      { domain: "mathworks.com",         careers: "https://www.mathworks.com/company/jobs",         name: "MathWorks",             industry: "Technology" },
  "EMC":                                { domain: "dell.com",              careers: "https://jobs.dell.com",                          name: "Dell Technologies",     industry: "Technology" },
  "EPAM SYSTEMS":                       { domain: "epam.com",              careers: "https://www.epam.com/careers",                   name: "EPAM Systems",          industry: "Technology" },
  "HTC GLOBAL SERVICES":                { domain: "htcglobalservices.com", careers: "https://www.htcglobalservices.com/careers",      name: "HTC Global Services",   industry: "Technology" },
  "WIPRO":                              { domain: "wipro.com",             careers: "https://careers.wipro.com",                     name: "Wipro",                 industry: "Technology" },
  "INFOSYS":                            { domain: "infosys.com",           careers: "https://www.infosys.com/careers",                name: "Infosys",               industry: "Technology" },
  "TATA CONSULTANCY SERVICES":          { domain: "tcs.com",               careers: "https://www.tcs.com/careers",                    name: "Tata Consultancy Services", industry: "Technology" },
  "HCL AMERICA":                        { domain: "hcltech.com",           careers: "https://www.hcltech.com/careers",                name: "HCL Technologies",      industry: "Technology" },
  "COGNIZANT TECHNOLOGY SOLUTIONS":     { domain: "cognizant.com",         careers: "https://careers.cognizant.com",                  name: "Cognizant",             industry: "Technology" },
  "TECH MAHINDRA":                      { domain: "techmahindra.com",      careers: "https://careers.techmahindra.com",               name: "Tech Mahindra",         industry: "Technology" },
  "PERSISTENT SYSTEMS":                 { domain: "persistent.com",        careers: "https://www.persistent.com/careers",             name: "Persistent Systems",    industry: "Technology" },
  "MPHASIS":                            { domain: "mphasis.com",           careers: "https://careers.mphasis.com",                   name: "Mphasis",               industry: "Technology" },
  "HEXAWARE TECHNOLOGIES":              { domain: "hexaware.com",          careers: "https://hexaware.com/careers",                   name: "Hexaware Technologies", industry: "Technology" },
  "MINDTREE":                           { domain: "mindtree.com",          careers: "https://www.mindtree.com/careers",               name: "Mindtree",              industry: "Technology" },
  "L&T TECHNOLOGY SERVICES":            { domain: "ltts.com",              careers: "https://www.ltts.com/careers",                   name: "L&T Technology Services", industry: "Technology" },
  "MASTECH":                            { domain: "mastech.com",           careers: "https://www.mastech.com/careers",                name: "Mastech",               industry: "Technology" },
  "LARSEN & TOUBRO INFOTECH":           { domain: "lntinfotech.com",       careers: "https://www.lntinfotech.com/careers",            name: "LTI (Larsen & Toubro Infotech)", industry: "Technology" },
  "CONDUENT BUSINESS SERVICES":         { domain: "conduent.com",          careers: "https://careers.conduent.com",                   name: "Conduent",              industry: "Technology" },
  "CGI TECHNOLOGIES AND SOLUTIONS":     { domain: "cgi.com",               careers: "https://www.cgi.com/en/careers",                 name: "CGI",                   industry: "Technology" },
  "DXC TECHNOLOGY":                     { domain: "dxc.com",               careers: "https://jobs.dxc.com",                           name: "DXC Technology",        industry: "Technology" },
  "UNISYS":                             { domain: "unisys.com",            careers: "https://www.unisys.com/careers",                 name: "Unisys",                industry: "Technology" },
  "LEIDOS":                             { domain: "leidos.com",            careers: "https://careers.leidos.com",                    name: "Leidos",                industry: "Technology" },
  "SAIC":                               { domain: "saic.com",              careers: "https://careers.saic.com",                      name: "SAIC",                  industry: "Technology" },
  "BOOZ ALLEN HAMILTON":                { domain: "boozallen.com",         careers: "https://careers.boozallen.com",                  name: "Booz Allen Hamilton",   industry: "Technology" },

  // Finance
  "MORGAN STANLEY SERVICES GROUP":      { domain: "morganstanley.com",     careers: "https://www.morganstanley.com/people/careers",   name: "Morgan Stanley",        industry: "Finance" },
  "PRICEWATERHOUSECOOPERS":             { domain: "pwc.com",               careers: "https://www.pwc.com/us/en/careers.html",         name: "PwC",                   industry: "Finance" },
  "FIDELITY TECHNOLOGY GROUP":          { domain: "fidelity.com",          careers: "https://jobs.fidelity.com",                      name: "Fidelity Investments",  industry: "Finance" },
  "UBS BUSINESS SOLUTIONS":             { domain: "ubs.com",               careers: "https://www.ubs.com/global/en/careers.html",     name: "UBS",                   industry: "Finance" },
  "DFS CORPORATE SERVICES":             { domain: "discover.com",          careers: "https://jobs.discover.com",                      name: "Discover Financial",    industry: "Finance" },
  "ADP TECHNOLOGY SERVICES":            { domain: "adp.com",               careers: "https://jobs.adp.com",                           name: "ADP",                   industry: "Finance" },
  "VERIZON DATA SERVICES":              { domain: "verizon.com",           careers: "https://www.verizon.com/about/work-here",        name: "Verizon",               industry: "Technology" },
  "COMCAST CABLE COMMUNICATIONS":       { domain: "comcast.com",           careers: "https://jobs.comcast.com",                       name: "Comcast",               industry: "Technology" },
  "DELOITTE":                           { domain: "deloitte.com",          careers: "https://www2.deloitte.com/us/en/careers.html",   name: "Deloitte",              industry: "Finance" },
  "ERNST & YOUNG":                      { domain: "ey.com",                careers: "https://www.ey.com/en_us/careers",               name: "EY (Ernst & Young)",    industry: "Finance" },
  "KPMG":                               { domain: "kpmg.com",              careers: "https://www.kpmg.us/careers.html",               name: "KPMG",                  industry: "Finance" },
  "THE BOSTON CONSULTING GROUP":        { domain: "bcg.com",               careers: "https://careers.bcg.com",                        name: "BCG",                   industry: "Finance" },
  "MCKINSEY & COMPANY":                 { domain: "mckinsey.com",          careers: "https://www.mckinsey.com/careers",               name: "McKinsey & Company",    industry: "Finance" },
  "JPMORGAN CHASE":                     { domain: "jpmorganchase.com",     careers: "https://careers.jpmorgan.com",                   name: "JPMorgan Chase",        industry: "Finance" },
  "BANK OF AMERICA":                    { domain: "bankofamerica.com",     careers: "https://careers.bankofamerica.com",              name: "Bank of America",       industry: "Finance" },
  "WELLS FARGO":                        { domain: "wellsfargo.com",        careers: "https://www.wellsfargo.com/about/careers",       name: "Wells Fargo",           industry: "Finance" },
  "CITIBANK":                           { domain: "citi.com",              careers: "https://jobs.citi.com",                          name: "Citibank",              industry: "Finance" },
  "GOLDMAN SACHS":                      { domain: "goldmansachs.com",      careers: "https://www.goldmansachs.com/careers",           name: "Goldman Sachs",         industry: "Finance" },
  "AMERICAN EXPRESS":                   { domain: "americanexpress.com",   careers: "https://jobs.americanexpress.com",               name: "American Express",      industry: "Finance" },
  "AMERICAN EXPRESS TRAVEL RELATED SERVICES": { domain: "americanexpress.com", careers: "https://jobs.americanexpress.com",          name: "American Express",      industry: "Finance" },
  "CAPITAL ONE":                        { domain: "capitalone.com",        careers: "https://www.capitalone.com/tech/careers",        name: "Capital One",           industry: "Finance" },
  "CHARLES SCHWAB":                     { domain: "schwab.com",            careers: "https://jobs.schwabjobs.com",                    name: "Charles Schwab",        industry: "Finance" },
  "BLACKROCK":                          { domain: "blackrock.com",         careers: "https://careers.blackrock.com",                  name: "BlackRock",             industry: "Finance" },
  "T ROWE PRICE":                       { domain: "troweprice.com",        careers: "https://www.troweprice.com/personal-investing/about-t-rowe-price/careers.html", name: "T. Rowe Price", industry: "Finance" },
  "NORTHERN TRUST":                     { domain: "northerntrust.com",     careers: "https://www.northerntrust.com/united-states/careers", name: "Northern Trust",  industry: "Finance" },
  "RAYMOND JAMES":                      { domain: "raymondjames.com",      careers: "https://www.raymondjames.com/careers",           name: "Raymond James",         industry: "Finance" },

  // Healthcare / Pharma
  "JOHNSON & JOHNSON":                  { domain: "jnj.com",               careers: "https://jobs.jnj.com",                           name: "Johnson & Johnson",     industry: "Healthcare" },
  "PFIZER":                             { domain: "pfizer.com",            careers: "https://www.pfizer.com/people/jobs",             name: "Pfizer",                industry: "Healthcare" },
  "ABBVIE":                             { domain: "abbvie.com",            careers: "https://careers.abbvie.com",                    name: "AbbVie",                industry: "Healthcare" },
  "AMGEN":                              { domain: "amgen.com",             careers: "https://careers.amgen.com",                     name: "Amgen",                 industry: "Healthcare" },
  "BIOGEN":                             { domain: "biogen.com",            careers: "https://www.biogen.com/en_us/careers.html",     name: "Biogen",                industry: "Healthcare" },
  "REGENERON PHARMACEUTICALS":          { domain: "regeneron.com",         careers: "https://careers.regeneron.com",                  name: "Regeneron",             industry: "Healthcare" },
  "GILEAD SCIENCES":                    { domain: "gilead.com",            careers: "https://www.gilead.com/careers",                 name: "Gilead Sciences",       industry: "Healthcare" },
  "VERTEX PHARMACEUTICALS":             { domain: "vrtx.com",              careers: "https://www.vrtx.com/careers",                   name: "Vertex Pharmaceuticals", industry: "Healthcare" },
  "BRISTOL MYERS SQUIBB":               { domain: "bms.com",               careers: "https://careers.bms.com",                        name: "Bristol Myers Squibb",  industry: "Healthcare" },
  "ELI LILLY":                          { domain: "lilly.com",             careers: "https://jobs.lilly.com",                         name: "Eli Lilly",             industry: "Healthcare" },
  "MERCK":                              { domain: "merck.com",             careers: "https://jobs.merck.com",                         name: "Merck",                 industry: "Healthcare" },
  "BAXTER":                             { domain: "baxter.com",            careers: "https://jobs.baxter.com",                        name: "Baxter",                industry: "Healthcare" },
  "BECTON DICKINSON":                   { domain: "bd.com",                careers: "https://jobs.bd.com",                            name: "Becton Dickinson",      industry: "Healthcare" },
  "ASTRAZENECA":                        { domain: "astrazeneca.com",       careers: "https://careers.astrazeneca.com",                name: "AstraZeneca",           industry: "Healthcare" },
  "NOVARTIS":                           { domain: "novartis.com",          careers: "https://www.novartis.com/careers",               name: "Novartis",              industry: "Healthcare" },
  "ROCHE":                              { domain: "roche.com",             careers: "https://www.roche.com/careers.htm",              name: "Roche",                 industry: "Healthcare" },
  "GENENTECH":                          { domain: "gene.com",              careers: "https://www.gene.com/careers",                   name: "Genentech",             industry: "Healthcare" },
  "MEDTRONIC":                          { domain: "medtronic.com",         careers: "https://jobs.medtronic.com",                     name: "Medtronic",             industry: "Healthcare" },
  "STRYKER":                            { domain: "stryker.com",           careers: "https://careers.stryker.com",                   name: "Stryker",               industry: "Healthcare" },
  "HOLOGIC":                            { domain: "hologic.com",           careers: "https://careers.hologic.com",                    name: "Hologic",               industry: "Healthcare" },
  "QUEST DIAGNOSTICS":                  { domain: "questdiagnostics.com",  careers: "https://careers.questdiagnostics.com",           name: "Quest Diagnostics",     industry: "Healthcare" },
  "LABCORP":                            { domain: "labcorp.com",           careers: "https://careers.labcorp.com",                    name: "LabCorp",               industry: "Healthcare" },
  "CVS PHARMACY":                       { domain: "cvshealth.com",         careers: "https://jobs.cvshealth.com",                     name: "CVS Health",            industry: "Healthcare" },
  "UNITEDHEALTH GROUP":                 { domain: "unitedhealthgroup.com", careers: "https://careers.unitedhealthgroup.com",          name: "UnitedHealth Group",    industry: "Healthcare" },
  "ANTHEM":                             { domain: "anthem.com",            careers: "https://careers.anthem.com",                     name: "Anthem (Elevance Health)", industry: "Healthcare" },
  "HUMANA":                             { domain: "humana.com",            careers: "https://careers.humana.com",                    name: "Humana",                industry: "Healthcare" },
  "MAYO CLINIC":                        { domain: "mayoclinic.org",        careers: "https://jobs.mayoclinic.org",                    name: "Mayo Clinic",           industry: "Healthcare" },
  "CLEVELAND CLINIC":                   { domain: "clevelandclinic.org",   careers: "https://jobs.clevelandclinic.org",               name: "Cleveland Clinic",      industry: "Healthcare" },

  // Universities
  "THE LELAND STANFORD JR UNIVERSITY":  { domain: "stanford.edu",          careers: "https://careers.stanford.edu",                   name: "Stanford University",   industry: "Education" },
  "JOHNS HOPKINS UNIVERSITY":           { domain: "jhu.edu",               careers: "https://jobs.jhu.edu",                           name: "Johns Hopkins University", industry: "Education" },
  "WASHINGTON UNIVERSITY IN ST LOUIS":  { domain: "wustl.edu",             careers: "https://hr.wustl.edu/careers",                   name: "Washington University in St. Louis", industry: "Education" },
  "COLUMBIA UNIVERSITY":                { domain: "columbia.edu",          careers: "https://opportunities.columbia.edu",             name: "Columbia University",   industry: "Education" },
  "THE UNIVERSITY OF CHICAGO":          { domain: "uchicago.edu",          careers: "https://www.uchicago.edu/join-our-community",    name: "University of Chicago", industry: "Education" },
  "EMORY UNIVERSITY":                   { domain: "emory.edu",             careers: "https://hr.emory.edu/eu/working-here/jobs",      name: "Emory University",      industry: "Education" },
  "UNIVERSITY OF MICHIGAN":             { domain: "umich.edu",             careers: "https://careers.umich.edu",                      name: "University of Michigan", industry: "Education" },
  "UNIVERSITY OF TEXAS":                { domain: "utexas.edu",            careers: "https://utaustin.csod.com",                      name: "University of Texas at Austin", industry: "Education" },
  "CARNEGIE MELLON UNIVERSITY":         { domain: "cmu.edu",               careers: "https://jobs.cmu.edu",                           name: "Carnegie Mellon University", industry: "Education" },
  "GEORGIA INSTITUTE OF TECHNOLOGY":    { domain: "gatech.edu",            careers: "https://hr.gatech.edu/talent-acquisition",       name: "Georgia Tech",          industry: "Education" },
  "PURDUE UNIVERSITY":                  { domain: "purdue.edu",            careers: "https://www.purdue.edu/careers",                 name: "Purdue University",     industry: "Education" },
  "PENNSYLVANIA STATE UNIVERSITY":      { domain: "psu.edu",               careers: "https://hr.psu.edu/job-openings",                name: "Penn State University", industry: "Education" },
  "UNIVERSITY OF WASHINGTON":           { domain: "uw.edu",                careers: "https://careers.uw.edu",                         name: "University of Washington", industry: "Education" },
  "UNIVERSITY OF CALIFORNIA":           { domain: "universityofcalifornia.edu", careers: "https://jobs.universityofcalifornia.edu",   name: "University of California", industry: "Education" },
  "DUKE UNIVERSITY":                    { domain: "duke.edu",              careers: "https://careers.duke.edu",                       name: "Duke University",       industry: "Education" },
  "VANDERBILT UNIVERSITY":              { domain: "vanderbilt.edu",        careers: "https://hr.vanderbilt.edu",                      name: "Vanderbilt University", industry: "Education" },
  "UNIVERSITY OF ILLINOIS":             { domain: "illinois.edu",          careers: "https://humanresources.illinois.edu/careers",    name: "University of Illinois", industry: "Education" },
  "UNIVERSITY OF MINNESOTA":            { domain: "umn.edu",               careers: "https://hr.umn.edu/jobs",                        name: "University of Minnesota", industry: "Education" },
  "NEW YORK UNIVERSITY":                { domain: "nyu.edu",               careers: "https://www.nyu.edu/employees/job-opportunities.html", name: "New York University", industry: "Education" },
  "BOSTON UNIVERSITY":                  { domain: "bu.edu",                careers: "https://www.bu.edu/hr/careers",                  name: "Boston University",     industry: "Education" },
  "CASE WESTERN RESERVE UNIVERSITY":    { domain: "case.edu",              careers: "https://hr.case.edu/careers",                    name: "Case Western Reserve",  industry: "Education" },
  "RICE UNIVERSITY":                    { domain: "rice.edu",              careers: "https://jobs.rice.edu",                          name: "Rice University",       industry: "Education" },
  "TUFTS UNIVERSITY":                   { domain: "tufts.edu",             careers: "https://jobs.tufts.edu",                         name: "Tufts University",      industry: "Education" },
  "NORTHEASTERN UNIVERSITY":            { domain: "northeastern.edu",      careers: "https://northeastern.edu/careers",               name: "Northeastern University", industry: "Education" },
  "UNIVERSITY OF SOUTHERN CALIFORNIA":  { domain: "usc.edu",               careers: "https://usccareers.usc.edu",                     name: "University of Southern California", industry: "Education" },
  "RUTGERS":                            { domain: "rutgers.edu",           careers: "https://jobs.rutgers.edu",                       name: "Rutgers University",    industry: "Education" },

  // Telecom / Media
  "AT&T SERVICES":                      { domain: "att.com",               careers: "https://work.att.jobs",                          name: "AT&T",                  industry: "Technology" },
  "VERIZON COMMUNICATIONS":             { domain: "verizon.com",           careers: "https://www.verizon.com/about/work-here",        name: "Verizon",               industry: "Technology" },
  "T MOBILE":                           { domain: "t-mobile.com",          careers: "https://careers.t-mobile.com",                   name: "T-Mobile",              industry: "Technology" },
  "CHARTER COMMUNICATIONS":             { domain: "charter.com",           careers: "https://jobs.spectrum.com",                      name: "Charter Communications (Spectrum)", industry: "Technology" },
  "DISNEY":                             { domain: "disney.com",            careers: "https://jobs.disneycareers.com",                 name: "Disney",                industry: "Technology" },
  "WARNER BROS":                        { domain: "wbd.com",               careers: "https://careers.wbd.com",                        name: "Warner Bros. Discovery", industry: "Technology" },
  "NBCUniversal":                       { domain: "nbcuniversal.com",      careers: "https://www.nbcunicareers.com",                   name: "NBCUniversal",          industry: "Technology" },
  "FOX":                                { domain: "foxcorporation.com",    careers: "https://foxcorporation.com/careers",             name: "Fox Corporation",       industry: "Technology" },

  // Defense / Aerospace
  "LOCKHEED MARTIN":                    { domain: "lockheedmartin.com",    careers: "https://www.lockheedmartinjobs.com",             name: "Lockheed Martin",       industry: "Technology" },
  "RAYTHEON":                           { domain: "rtx.com",               careers: "https://careers.rtx.com",                        name: "Raytheon Technologies", industry: "Technology" },
  "NORTHROP GRUMMAN":                   { domain: "northropgrumman.com",   careers: "https://www.northropgrumman.com/careers",        name: "Northrop Grumman",      industry: "Technology" },
  "GENERAL DYNAMICS":                   { domain: "gd.com",                careers: "https://gdcareers.com",                          name: "General Dynamics",      industry: "Technology" },
  "L3HARRIS TECHNOLOGIES":              { domain: "l3harris.com",          careers: "https://careers.l3harris.com",                   name: "L3Harris Technologies", industry: "Technology" },

  // Automotive / Energy / Industrial
  "GENERAL MOTORS":                     { domain: "gm.com",                careers: "https://careers.gm.com",                         name: "General Motors",        industry: "Technology" },
  "FORD MOTOR":                         { domain: "ford.com",              careers: "https://corporate.ford.com/careers.html",        name: "Ford Motor Company",    industry: "Technology" },
  "STELLANTIS":                         { domain: "stellantis.com",        careers: "https://www.stellantis.com/en/careers",          name: "Stellantis",            industry: "Technology" },
  "TOYOTA MOTOR NORTH AMERICA":         { domain: "toyota.com",            careers: "https://www.toyota.com/careers",                 name: "Toyota",                industry: "Technology" },
  "GENERAL ELECTRIC":                   { domain: "ge.com",                careers: "https://jobs.ge.com",                            name: "GE",                    industry: "Technology" },
  "HONEYWELL":                          { domain: "honeywell.com",         careers: "https://careers.honeywell.com",                  name: "Honeywell",             industry: "Technology" },
  "EATON":                              { domain: "eaton.com",             careers: "https://eaton.eightfold.ai/careers",             name: "Eaton",                 industry: "Technology" },
  "SCHLUMBERGER":                       { domain: "slb.com",               careers: "https://careers.slb.com",                        name: "SLB (Schlumberger)",    industry: "Technology" },
  "HALLIBURTON":                        { domain: "halliburton.com",       careers: "https://jobs.halliburton.com",                   name: "Halliburton",           industry: "Technology" },
  "CHEVRON":                            { domain: "chevron.com",           careers: "https://careers.chevron.com",                    name: "Chevron",               industry: "Technology" },
  "EXXONMOBIL":                         { domain: "exxonmobil.com",        careers: "https://jobs.exxonmobil.com",                    name: "ExxonMobil",            industry: "Technology" },

  // Retail / CPG
  "AMAZON COM SERVICES":                { domain: "amazon.com",            careers: "https://www.amazon.jobs",                        name: "Amazon",                industry: "Technology" },
  "PROCTER & GAMBLE":                   { domain: "pg.com",                careers: "https://www.pgcareers.com",                      name: "Procter & Gamble",      industry: "Retail" },
  "COLGATE PALMOLIVE":                  { domain: "colgatepalmolive.com",  careers: "https://jobs.colgatepalmolive.com",              name: "Colgate-Palmolive",     industry: "Retail" },
}

// ─── Staffing/temp firm filter ────────────────────────────────────────────────

const SKIP_KEYWORDS = [
  /\bSTAFFING\b/, /\bRECRUIT/i, /\bPLACEMENT\b/, /\bTEMPORAR/i,
  /\bCONTRACTOR\b/, /\bOUTSOURCING\b/, /\bOUTSOURCED\b/,
  /\bPEO\b/, /^APPLE ONE\b/, /^SPHERION\b/, /^KELLY SERVICES\b/,
  /^MANPOWER\b/, /^ADECCO\b/, /^RANDSTAD\b/, /^ROBERT HALF\b/,
  /^KFORCE\b/, /^VOLT\b/, /^INSIGHT GLOBAL\b/,
]

function shouldSkip(name: string): boolean {
  return SKIP_KEYWORDS.some((re) => re.test(name.toUpperCase()))
}

// ─── Name normalization (same as enrich-h1b.ts) ───────────────────────────────

const LEGAL = new Set([
  "INC","INCORPORATED","LLC","LTD","LIMITED","CORP","CORPORATION",
  "CO","COMPANY","PLC","LLP","LP","HOLDINGS","HOLDING",
  "SERVICES","SOLUTIONS","TECHNOLOGIES","TECHNOLOGY","SYSTEMS",
  "GROUP","GLOBAL","AMERICA","AMERICAS","USA","US",
])

function normalizeKey(name: string): string {
  return name.toUpperCase()
    .replace(/&/g, " AND ")
    .replace(/[^A-Z0-9 ]+/g, " ")
    .split(/\s+/).filter(Boolean).filter((t) => !LEGAL.has(t))
    .join(" ").trim()
}

function guessPublicDomain(name: string): string | null {
  const stripped = name.toLowerCase()
    .replace(/\b(incorporated|inc|l\.?l\.?c\.?|llp|corp|corporation|ltd|limited|co|company|plc|holdings|group|technologies|technology|solutions|services|systems|us|usa|america|americas|north\s+america|d\.?b\.?a\.?.*)/g, " ")
    .replace(/[^a-z0-9]+/g, "").trim()
  if (!stripped || stripped.length < 3) return null
  return `${stripped}.com`
}

function toDisplayName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\b(\w)/g, (c) => c.toUpperCase())
    .replace(/\bLlc\b/g, "LLC").replace(/\bInc\b/g, "Inc.")
    .replace(/\bCorp\b/g, "Corp.").replace(/\bLtd\b/g, "Ltd.")
    .replace(/D\.?B\.?A\.?.*/i, "").trim()
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n[enrich-add] mode=${execute ? "EXECUTE" : "DRY RUN"} target=${TARGET} min_approvals=${MIN_APPROVALS}\n`)

  const pool = new Pool({ connectionString: process.env.DATABASE_URL })

  // Current count
  const { rows: [{ count: currentCount }] } = await pool.query<{ count: string }>(
    "SELECT COUNT(*) AS count FROM companies"
  )
  const current = Number(currentCount)
  const need = TARGET - current
  console.log(`[enrich-add] Current: ${current} | Target: ${TARGET} | Need: ${need}`)

  if (need <= 0) {
    console.log("[enrich-add] Already at or above target. Done.")
    await pool.end()
    return
  }

  // Load existing domains to avoid duplicates
  const { rows: existingRows } = await pool.query<{ domain: string; name: string }>(
    "SELECT domain, name FROM companies"
  )
  const existingDomains = new Set(existingRows.map((r) => r.domain.toLowerCase()))
  const existingNames = new Set(existingRows.map((r) => normalizeKey(r.name)))

  // Pull top unmatched H1B employers
  const { rows: employers } = await pool.query<{
    employer_name: string
    total_approved: string
    total_denied: string
  }>(`
    SELECT employer_name,
           SUM(COALESCE(approved, 0)) AS total_approved,
           SUM(COALESCE(denied,   0)) AS total_denied
    FROM h1b_records
    WHERE company_id IS NULL
      AND employer_name IS NOT NULL
    GROUP BY employer_name
    HAVING SUM(COALESCE(approved, 0)) >= $1
    ORDER BY total_approved DESC
  `, [MIN_APPROVALS])

  console.log(`[enrich-add] ${employers.length.toLocaleString()} unmatched employers with >= ${MIN_APPROVALS} approvals`)

  let created = 0
  let skipped = 0

  for (const emp of employers) {
    if (created >= need) break

    const empName = emp.employer_name
    const approved = Number(emp.total_approved)
    const denied = Number(emp.total_denied)

    if (shouldSkip(empName)) { skipped++; continue }

    // Check override table first
    const normKey = normalizeKey(empName)
    const override = OVERRIDES[normKey] ?? Object.entries(OVERRIDES).find(([k]) => normKey.startsWith(k) || k.startsWith(normKey))?.[1]

    const domain = override?.domain ?? guessPublicDomain(empName)
    if (!domain) { skipped++; continue }

    const domainLower = domain.toLowerCase()
    if (existingDomains.has(domainLower)) { skipped++; continue }

    const displayName = override?.name ?? toDisplayName(empName)
    const normDisplay = normalizeKey(displayName)
    if (existingNames.has(normDisplay)) { skipped++; continue }

    const careersUrl = override?.careers
      ?? `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(displayName)}&f_TPR=r2592000`
    const logoUrl = companyLogoUrlFromDomain(domain, "clearbit")
    const industry = override?.industry ?? "Technology"

    // Compute H1B confidence
    const total = approved + denied
    const rate = total > 0 ? approved / total : 0
    let conf = 0
    if (approved > 0) conf += 70
    if (rate > 0.8)   conf += 10
    if (approved > 10) conf += 10
    if (approved > 50) conf += 10
    conf = Math.min(100, conf)

    console.log(
      `${execute ? "+" : "[dry]"} ${displayName.slice(0, 50).padEnd(50)} ${domain.padEnd(35)} approved=${approved}`
    )

    if (execute) {
      try {
        const { rows: [newCompany] } = await pool.query<{ id: string }>(`
          INSERT INTO companies (
            name, domain, careers_url, logo_url, industry,
            is_active, sponsors_h1b, sponsorship_confidence,
            h1b_sponsor_count_1yr, h1b_sponsor_count_3yr, updated_at
          ) VALUES ($1,$2,$3,$4,$5, true,$6,$7,$8,$9, NOW())
          ON CONFLICT (domain) DO NOTHING
          RETURNING id
        `, [
          displayName.slice(0, 140),
          domainLower,
          careersUrl,
          logoUrl,
          industry,
          approved > 0,
          conf,
          approved,
          approved, // rough 3yr = 1yr for now, recompute will fix
        ])

        if (newCompany?.id) {
          existingDomains.add(domainLower)
          existingNames.add(normDisplay)

          // Link h1b_records
          await pool.query(
            "UPDATE h1b_records SET company_id = $1 WHERE employer_name = $2 AND company_id IS NULL",
            [newCompany.id, empName]
          )
          created++
        } else {
          skipped++ // conflict — already existed
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e)
        if (!/duplicate|23505/i.test(msg)) console.error(`  ERROR: ${msg}`)
        skipped++
      }
    } else {
      created++
      existingDomains.add(domainLower)
      existingNames.add(normDisplay)
    }
  }

  console.log(`\n${execute ? "Created" : "Would create"}: ${created} | Skipped: ${skipped}`)
  console.log(`New total: ${current + (execute ? created : created)}`)
  if (!execute) console.log("Re-run with --execute to apply.")

  await pool.end()
}

main().catch((e) => { console.error(e); process.exit(1) })
