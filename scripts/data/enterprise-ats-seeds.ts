/**
 * Enterprise-scale seed list, biased toward SAP SuccessFactors, Oracle Taleo,
 * and Oracle Cloud HCM tenants — the three ATSes that average 300-500 jobs
 * per company in our data.
 *
 * Why this list exists separately from `company-seeds-expansion.ts`:
 *   1. These are LARGE employers (10k+ headcount typical) where one tenant
 *      adds hundreds of jobs to the active set.
 *   2. We don't pre-populate `ats_type` / `ats_identifier` — the seed script
 *      runs `resolveDirectAtsUrl` on each entry, so the wrapper-page-versus-
 *      direct-ATS problem from the May 19 cleanup doesn't recur.
 *   3. Coverage: Fortune-1000 tech / healthcare / financial / retail / CPG /
 *      industrial — sectors that disproportionately rely on enterprise ATSes.
 *
 * Each row is a hint, not a guarantee. The seed script probes every entry
 * before inserting; rows whose ATS can't be resolved are skipped.
 */

import type { CompanySize, SeedExtra } from "./company-seeds"

export const ENTERPRISE_ATS_SEED_ROWS: ReadonlyArray<
  | readonly [string, string, string, string, CompanySize]
  | readonly [string, string, string, string, CompanySize, SeedExtra]
> = [
  // ── Big Tech / Software (Oracle Cloud HCM, SF, Workday — let resolver decide) ──
  ["Cisco Systems", "cisco.com", "https://jobs.cisco.com", "Technology", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 88 }],
  ["IBM", "ibm.com", "https://www.ibm.com/careers", "Technology", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 90 }],
  ["Oracle", "oracle.com", "https://www.oracle.com/careers", "Technology", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 92 }],
  ["SAP", "sap.com", "https://jobs.sap.com", "Technology", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 88 }],
  ["Salesforce", "salesforce.com", "https://careers.salesforce.com", "Technology", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 90 }],
  ["VMware", "vmware.com", "https://careers.vmware.com", "Technology", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 85 }],
  ["Adobe", "adobe.com", "https://careers.adobe.com", "Technology", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 88 }],
  ["Accenture", "accenture.com", "https://www.accenture.com/us-en/careers", "Consulting", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 92 }],
  ["Capgemini", "capgemini.com", "https://www.capgemini.com/careers", "Consulting", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 85 }],
  ["Cognizant", "cognizant.com", "https://careers.cognizant.com", "Consulting", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 90 }],
  ["Wipro", "wipro.com", "https://careers.wipro.com", "Consulting", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 85 }],
  ["Tata Consultancy Services", "tcs.com", "https://www.tcs.com/careers", "Consulting", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 85 }],
  ["HCLTech", "hcltech.com", "https://www.hcltech.com/careers-in", "Consulting", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 85 }],
  ["Tech Mahindra", "techmahindra.com", "https://careers.techmahindra.com", "Consulting", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 80 }],
  ["DXC Technology", "dxc.com", "https://careers.dxc.com", "Technology", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 75 }],
  ["NTT Data", "nttdata.com", "https://careers.nttdata.com", "Technology", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 80 }],

  // ── Pharma / Biotech (heavy SuccessFactors and Workday users) ────────────
  ["Pfizer", "pfizer.com", "https://www.pfizer.com/about/careers", "Healthcare", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 85 }],
  ["Johnson & Johnson", "jnj.com", "https://www.careers.jnj.com", "Healthcare", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 85 }],
  ["Merck", "merck.com", "https://jobs.merck.com", "Healthcare", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 85 }],
  ["AbbVie", "abbvie.com", "https://careers.abbvie.com", "Healthcare", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 85 }],
  ["Eli Lilly", "lilly.com", "https://careers.lilly.com", "Healthcare", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 85 }],
  ["Novartis", "novartis.com", "https://www.novartis.com/careers", "Healthcare", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 85 }],
  ["Roche", "roche.com", "https://careers.roche.com", "Healthcare", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 82 }],
  ["GlaxoSmithKline", "gsk.com", "https://www.gsk.com/en-gb/careers/", "Healthcare", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 80 }],
  ["AstraZeneca", "astrazeneca.com", "https://careers.astrazeneca.com", "Healthcare", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 82 }],
  ["Bayer", "bayer.com", "https://career.bayer.com", "Healthcare", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 80 }],
  ["Sanofi", "sanofi.com", "https://www.sanofi.com/en/careers", "Healthcare", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 80 }],
  ["Bristol Myers Squibb", "bms.com", "https://careers.bms.com", "Healthcare", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 85 }],
  ["Boehringer Ingelheim", "boehringer-ingelheim.com", "https://www.boehringer-ingelheim.com/careers", "Healthcare", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 80 }],
  ["Takeda", "takeda.com", "https://www.takeda.com/careers", "Healthcare", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 82 }],
  ["Astellas Pharma", "astellas.com", "https://www.astellas.com/en/careers", "Healthcare", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 78 }],
  ["Biogen", "biogen.com", "https://www.biogen.com/careers", "Healthcare", "large", { sponsors_h1b: true, sponsorship_confidence: 82 }],
  ["Regeneron", "regeneron.com", "https://careers.regeneron.com", "Healthcare", "large", { sponsors_h1b: true, sponsorship_confidence: 85 }],
  ["Vertex Pharmaceuticals", "vrtx.com", "https://careers.vrtx.com", "Healthcare", "large", { sponsors_h1b: true, sponsorship_confidence: 82 }],
  ["Amgen", "amgen.com", "https://careers.amgen.com", "Healthcare", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 85 }],
  ["Gilead Sciences", "gilead.com", "https://www.gilead.com/careers", "Healthcare", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 85 }],
  ["Moderna", "modernatx.com", "https://www.modernatx.com/careers", "Healthcare", "large", { sponsors_h1b: true, sponsorship_confidence: 85 }],

  // ── Hospitals / Health Systems (heavy Taleo + Oracle Cloud HCM) ──────────
  ["Cleveland Clinic", "clevelandclinic.org", "https://jobs.clevelandclinic.org", "Healthcare", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 70 }],
  ["Mayo Clinic", "mayoclinic.org", "https://jobs.mayoclinic.org", "Healthcare", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 70 }],
  ["HCA Healthcare", "hcahealthcare.com", "https://careers.hcahealthcare.com", "Healthcare", "enterprise", { sponsors_h1b: false, sponsorship_confidence: 45 }],
  ["Kaiser Permanente", "kaiserpermanente.org", "https://www.kaiserpermanentejobs.org", "Healthcare", "enterprise", { sponsors_h1b: false, sponsorship_confidence: 50 }],
  ["CommonSpirit Health", "commonspirit.org", "https://careers.commonspirit.org", "Healthcare", "enterprise", { sponsors_h1b: false, sponsorship_confidence: 45 }],
  ["AdventHealth", "adventhealth.com", "https://jobs.adventhealth.com", "Healthcare", "enterprise", { sponsors_h1b: false, sponsorship_confidence: 45 }],
  ["Ascension", "ascension.org", "https://careers.ascension.org", "Healthcare", "enterprise", { sponsors_h1b: false, sponsorship_confidence: 50 }],
  ["Trinity Health", "trinity-health.org", "https://jobs.trinity-health.org", "Healthcare", "enterprise", { sponsors_h1b: false, sponsorship_confidence: 45 }],
  ["Banner Health", "bannerhealth.com", "https://www.bannerhealth.com/careers", "Healthcare", "enterprise", { sponsors_h1b: false, sponsorship_confidence: 50 }],
  ["Intermountain Health", "intermountainhealthcare.org", "https://intermountainhealthcare.org/careers", "Healthcare", "enterprise", { sponsors_h1b: false, sponsorship_confidence: 45 }],
  ["NYU Langone Health", "nyulangone.org", "https://nyulangone.org/careers", "Healthcare", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 65 }],
  ["Mount Sinai", "mountsinai.org", "https://jobs.mountsinai.org", "Healthcare", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 65 }],
  ["Northwell Health", "northwell.edu", "https://jobs.northwell.edu", "Healthcare", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 60 }],
  ["Cedars-Sinai", "cedars-sinai.org", "https://careers.cedars-sinai.org", "Healthcare", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 60 }],
  ["Stanford Health Care", "stanfordhealthcare.org", "https://stanfordhealthcare.org/careers", "Healthcare", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 65 }],
  ["UCLA Health", "uclahealth.org", "https://uclahealth.org/careers", "Healthcare", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 60 }],
  ["Texas Health Resources", "texashealth.org", "https://jobs.texashealth.org", "Healthcare", "enterprise", { sponsors_h1b: false, sponsorship_confidence: 45 }],
  ["Memorial Sloan Kettering", "mskcc.org", "https://careers.mskcc.org", "Healthcare", "large", { sponsors_h1b: true, sponsorship_confidence: 70 }],
  ["MD Anderson Cancer Center", "mdanderson.org", "https://www.mdanderson.org/careers", "Healthcare", "large", { sponsors_h1b: true, sponsorship_confidence: 70 }],

  // ── Financial Services (Workday + Taleo + Oracle Cloud) ──────────────────
  ["JPMorgan Chase", "jpmorganchase.com", "https://careers.jpmorgan.com", "Finance", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 88 }],
  ["Bank of America", "bankofamerica.com", "https://careers.bankofamerica.com", "Finance", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 85 }],
  ["Citigroup", "citigroup.com", "https://jobs.citi.com", "Finance", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 85 }],
  ["Wells Fargo", "wellsfargo.com", "https://www.wellsfargojobs.com", "Finance", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 75 }],
  ["U.S. Bank", "usbank.com", "https://careers.usbank.com", "Finance", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 70 }],
  ["PNC Financial Services", "pnc.com", "https://careers.pnc.com", "Finance", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 72 }],
  ["Truist Financial", "truist.com", "https://careers.truist.com", "Finance", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 65 }],
  ["Capital One", "capitalone.com", "https://www.capitalonecareers.com", "Finance", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 88 }],
  ["American Express", "americanexpress.com", "https://www.americanexpress.com/en-us/careers/", "Finance", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 85 }],
  ["Charles Schwab", "schwab.com", "https://www.aboutschwab.com/careers", "Finance", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 78 }],
  ["Fidelity Investments", "fidelity.com", "https://jobs.fidelity.com", "Finance", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 80 }],
  ["State Street", "statestreet.com", "https://careers.statestreet.com", "Finance", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 78 }],
  ["BNY Mellon", "bnymellon.com", "https://jobs.bnymellon.com", "Finance", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 80 }],
  ["Northern Trust", "northerntrust.com", "https://careers.northerntrust.com", "Finance", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 78 }],
  ["TIAA", "tiaa.org", "https://careers.tiaa.org", "Finance", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 70 }],
  ["Prudential Financial", "prudential.com", "https://jobs.prudential.com", "Finance", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 75 }],
  ["MetLife", "metlife.com", "https://jobs.metlife.com", "Finance", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 75 }],
  ["The Hartford", "thehartford.com", "https://thehartford.com/careers", "Finance", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 65 }],
  ["Allstate", "allstate.com", "https://www.allstate.jobs", "Finance", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 65 }],
  ["Progressive", "progressive.com", "https://www.progressive.com/careers/", "Finance", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 65 }],
  ["Liberty Mutual", "libertymutual.com", "https://jobs.libertymutual.com", "Finance", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 70 }],
  ["Travelers", "travelers.com", "https://careers.travelers.com", "Finance", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 68 }],
  ["AIG", "aig.com", "https://careers.aig.com", "Finance", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 72 }],
  ["Chubb", "chubb.com", "https://www.chubb.com/us-en/careers/", "Finance", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 70 }],
  ["UBS", "ubs.com", "https://www.ubs.com/careers", "Finance", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 80 }],
  ["Deutsche Bank", "db.com", "https://careers.db.com", "Finance", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 78 }],

  // ── Retail / Consumer (Taleo + SF) ─────────────────────────────────────────
  ["Walmart", "walmart.com", "https://careers.walmart.com", "Retail", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 70 }],
  ["Target", "target.com", "https://corporate.target.com/careers", "Retail", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 70 }],
  ["The Home Depot", "homedepot.com", "https://careers.homedepot.com", "Retail", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 65 }],
  ["Lowe's", "lowes.com", "https://talent.lowes.com", "Retail", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 60 }],
  ["Costco Wholesale", "costco.com", "https://www.costco.com/jobs.html", "Retail", "enterprise", { sponsors_h1b: false, sponsorship_confidence: 40 }],
  ["Kroger", "kroger.com", "https://jobs.kroger.com", "Retail", "enterprise", { sponsors_h1b: false, sponsorship_confidence: 40 }],
  ["Albertsons", "albertsons.com", "https://careers.albertsons.com", "Retail", "enterprise", { sponsors_h1b: false, sponsorship_confidence: 40 }],
  ["CVS Health", "cvshealth.com", "https://jobs.cvshealth.com", "Healthcare", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 65 }],
  ["Walgreens", "walgreens.com", "https://jobs.walgreens.com", "Healthcare", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 60 }],
  ["Best Buy", "bestbuy.com", "https://www.bestbuy-jobs.com", "Retail", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 55 }],
  ["Macy's", "macys.com", "https://www.macysjobs.com", "Retail", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 55 }],
  ["Nordstrom", "nordstrom.com", "https://careers.nordstrom.com", "Retail", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 60 }],
  ["Gap Inc.", "gapinc.com", "https://jobs.gapinc.com", "Retail", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 60 }],
  ["Nike", "nike.com", "https://jobs.nike.com", "Retail", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 80 }],
  ["Levi Strauss", "levistrauss.com", "https://www.levistrauss.com/careers", "Retail", "large", { sponsors_h1b: true, sponsorship_confidence: 65 }],
  ["VF Corporation", "vfc.com", "https://www.vfc.com/careers", "Retail", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 65 }],
  ["L Brands", "lb.com", "https://www.lb.com/careers", "Retail", "large", { sponsors_h1b: true, sponsorship_confidence: 55 }],

  // ── Hospitality (heavy Taleo users historically) ─────────────────────────
  ["Marriott International", "marriott.com", "https://jobs.marriott.com", "Hospitality", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 65 }],
  ["Hilton Worldwide", "hilton.com", "https://jobs.hilton.com", "Hospitality", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 60 }],
  ["Hyatt Hotels", "hyatt.com", "https://careers.hyatt.com", "Hospitality", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 60 }],
  ["InterContinental Hotels Group", "ihg.com", "https://careers.ihg.com", "Hospitality", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 60 }],
  ["MGM Resorts International", "mgmresorts.com", "https://www.mgmresortscareers.com", "Hospitality", "enterprise", { sponsors_h1b: false, sponsorship_confidence: 50 }],
  ["Wynn Resorts", "wynnresorts.com", "https://jobs.wynnresorts.com", "Hospitality", "large", { sponsors_h1b: false, sponsorship_confidence: 50 }],
  ["Caesars Entertainment", "caesars.com", "https://caesars.com/careers", "Hospitality", "enterprise", { sponsors_h1b: false, sponsorship_confidence: 45 }],

  // ── CPG / Food (SF + Workday) ─────────────────────────────────────────────
  ["PepsiCo", "pepsico.com", "https://www.pepsicojobs.com", "Consumer Goods", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 80 }],
  ["The Coca-Cola Company", "coca-colacompany.com", "https://careers.coca-colacompany.com", "Consumer Goods", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 78 }],
  ["Procter & Gamble", "pg.com", "https://www.pgcareers.com", "Consumer Goods", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 82 }],
  ["Unilever", "unilever.com", "https://careers.unilever.com", "Consumer Goods", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 80 }],
  ["Nestlé", "nestle.com", "https://www.nestle.com/jobs", "Consumer Goods", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 72 }],
  ["Mondelez International", "mondelezinternational.com", "https://www.mondelezinternational.com/careers", "Consumer Goods", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 75 }],
  ["Kraft Heinz", "kraftheinzcompany.com", "https://careers.kraftheinz.com", "Consumer Goods", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 72 }],
  ["General Mills", "generalmills.com", "https://careers.generalmills.com", "Consumer Goods", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 75 }],
  ["Kellanova", "kellanova.com", "https://careers.kellanova.com", "Consumer Goods", "large", { sponsors_h1b: true, sponsorship_confidence: 72 }],
  ["Tyson Foods", "tysonfoods.com", "https://www.tysonfoods.com/careers", "Consumer Goods", "enterprise", { sponsors_h1b: false, sponsorship_confidence: 45 }],
  ["JBS Foods", "jbsfoodsgroup.com", "https://jbsfoodsgroup.com/careers", "Consumer Goods", "enterprise", { sponsors_h1b: false, sponsorship_confidence: 45 }],
  ["Colgate-Palmolive", "colgatepalmolive.com", "https://jobs.colgate.com", "Consumer Goods", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 78 }],
  ["Estée Lauder Companies", "elcompanies.com", "https://www.elcompanies.com/en/careers", "Consumer Goods", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 75 }],
  ["L'Oréal", "loreal.com", "https://careers.loreal.com", "Consumer Goods", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 75 }],
  ["Anheuser-Busch", "anheuser-busch.com", "https://www.anheuser-busch.com/careers", "Consumer Goods", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 70 }],
  ["Constellation Brands", "cbrands.com", "https://www.cbrands.com/careers", "Consumer Goods", "large", { sponsors_h1b: true, sponsorship_confidence: 70 }],

  // ── Industrial / Aerospace / Auto (SF + Workday + Taleo) ─────────────────
  ["Boeing", "boeing.com", "https://jobs.boeing.com", "Aerospace", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 80 }],
  ["Lockheed Martin", "lockheedmartin.com", "https://www.lockheedmartinjobs.com", "Aerospace", "enterprise", { sponsors_h1b: false, sponsorship_confidence: 30 }],
  ["Northrop Grumman", "northropgrumman.com", "https://www.northropgrumman.com/jobs/", "Aerospace", "enterprise", { sponsors_h1b: false, sponsorship_confidence: 30 }],
  ["Raytheon Technologies", "rtx.com", "https://careers.rtx.com", "Aerospace", "enterprise", { sponsors_h1b: false, sponsorship_confidence: 30 }],
  ["General Dynamics", "gd.com", "https://www.gd.com/careers", "Aerospace", "enterprise", { sponsors_h1b: false, sponsorship_confidence: 30 }],
  ["L3Harris Technologies", "l3harris.com", "https://careers.l3harris.com", "Aerospace", "enterprise", { sponsors_h1b: false, sponsorship_confidence: 30 }],
  ["Honeywell", "honeywell.com", "https://careers.honeywell.com", "Industrial", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 78 }],
  ["3M", "3m.com", "https://www.3m.com/careers", "Industrial", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 75 }],
  ["General Electric", "ge.com", "https://www.ge.com/careers", "Industrial", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 78 }],
  ["GE Vernova", "gevernova.com", "https://careers.gevernova.com", "Industrial", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 78 }],
  ["GE HealthCare", "gehealthcare.com", "https://careers.gehealthcare.com", "Healthcare", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 78 }],
  ["Siemens", "siemens.com", "https://jobs.siemens.com", "Industrial", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 80 }],
  ["Schneider Electric", "se.com", "https://www.se.com/ww/en/about-us/careers", "Industrial", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 75 }],
  ["Eaton", "eaton.com", "https://jobs.eaton.com", "Industrial", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 72 }],
  ["Emerson Electric", "emerson.com", "https://careers.emerson.com", "Industrial", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 70 }],
  ["Caterpillar", "caterpillar.com", "https://careers.caterpillar.com", "Industrial", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 72 }],
  ["Deere & Company", "deere.com", "https://careers.deere.com", "Industrial", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 72 }],
  ["Ford Motor Company", "ford.com", "https://corporate.ford.com/careers", "Automotive", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 70 }],
  ["General Motors", "gm.com", "https://careers.gm.com", "Automotive", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 72 }],
  ["Stellantis", "stellantis.com", "https://careers.stellantis.com", "Automotive", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 65 }],
  ["Toyota North America", "toyota.com", "https://www.toyota.com/usa/careers/", "Automotive", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 70 }],
  ["Honda North America", "honda.com", "https://careers.honda.com", "Automotive", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 65 }],
  ["BMW Group", "bmwgroup.com", "https://www.bmwgroup.jobs", "Automotive", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 70 }],
  ["Mercedes-Benz USA", "mbusa.com", "https://jobs.mbusa.com", "Automotive", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 65 }],
  ["Volkswagen Group", "vw.com", "https://www.volkswagen-group.com/en/career", "Automotive", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 65 }],
  ["Cummins", "cummins.com", "https://www.cummins.com/careers", "Industrial", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 75 }],
  ["Whirlpool", "whirlpoolcorp.com", "https://careers.whirlpoolcorp.com", "Industrial", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 65 }],

  // ── Energy / Utilities (Taleo + SF) ──────────────────────────────────────
  ["ExxonMobil", "exxonmobil.com", "https://corporate.exxonmobil.com/careers", "Energy", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 70 }],
  ["Chevron", "chevron.com", "https://careers.chevron.com", "Energy", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 72 }],
  ["ConocoPhillips", "conocophillips.com", "https://www.conocophillips.com/careers/", "Energy", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 65 }],
  ["Schlumberger", "slb.com", "https://careers.slb.com", "Energy", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 72 }],
  ["Halliburton", "halliburton.com", "https://jobs.halliburton.com", "Energy", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 60 }],
  ["Baker Hughes", "bakerhughes.com", "https://careers.bakerhughes.com", "Energy", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 70 }],
  ["Shell", "shell.com", "https://careers.shell.com", "Energy", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 75 }],
  ["BP", "bp.com", "https://www.bp.com/en/global/corporate/careers.html", "Energy", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 70 }],
  ["Duke Energy", "duke-energy.com", "https://www.duke-energy.com/our-company/careers", "Energy", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 60 }],
  ["Southern Company", "southerncompany.com", "https://careers.southerncompany.com", "Energy", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 55 }],
  ["NextEra Energy", "nexteraenergy.com", "https://www.nexteraenergy.com/careers.html", "Energy", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 65 }],
  ["Dominion Energy", "dominionenergy.com", "https://careers.dominionenergy.com", "Energy", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 55 }],
  ["Exelon", "exeloncorp.com", "https://careers.exeloncorp.com", "Energy", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 60 }],

  // ── Transportation / Logistics ───────────────────────────────────────────
  ["FedEx", "fedex.com", "https://careers.fedex.com", "Logistics", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 60 }],
  ["UPS", "ups.com", "https://www.jobs-ups.com", "Logistics", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 60 }],
  ["Delta Air Lines", "delta.com", "https://careers.delta.com", "Travel", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 60 }],
  ["United Airlines", "united.com", "https://careers.united.com", "Travel", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 65 }],
  ["American Airlines", "aa.com", "https://jobs.aa.com", "Travel", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 60 }],
  ["Southwest Airlines", "southwest.com", "https://careers.southwestair.com", "Travel", "enterprise", { sponsors_h1b: false, sponsorship_confidence: 45 }],
  ["Union Pacific", "up.com", "https://www.up.com/up/careers", "Logistics", "enterprise", { sponsors_h1b: false, sponsorship_confidence: 45 }],
  ["CSX", "csx.com", "https://careers.csx.com", "Logistics", "enterprise", { sponsors_h1b: false, sponsorship_confidence: 45 }],
  ["Norfolk Southern", "norfolksouthern.com", "https://www.norfolksouthern.com/en/careers.html", "Logistics", "enterprise", { sponsors_h1b: false, sponsorship_confidence: 45 }],

  // ── Telecom (Oracle Cloud + Taleo) ───────────────────────────────────────
  ["AT&T", "att.com", "https://www.att.jobs", "Telecom", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 70 }],
  ["Verizon", "verizon.com", "https://mycareer.verizon.com", "Telecom", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 75 }],
  ["T-Mobile", "t-mobile.com", "https://careers.t-mobile.com", "Telecom", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 70 }],
  ["Comcast", "comcast.com", "https://jobs.comcast.com", "Telecom", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 75 }],

  // ── Universities (Taleo / Oracle Cloud / iCIMS) ──────────────────────────
  ["Harvard University", "harvard.edu", "https://hr.harvard.edu/jobs", "Education", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 75 }],
  ["Stanford University", "stanford.edu", "https://careersearch.stanford.edu", "Education", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 75 }],
  ["Massachusetts Institute of Technology", "mit.edu", "https://careers.mit.edu", "Education", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 80 }],
  ["Yale University", "yale.edu", "https://your.yale.edu/work-yale/careers", "Education", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 72 }],
  ["Columbia University", "columbia.edu", "https://jobs.columbia.edu", "Education", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 72 }],
  ["University of Pennsylvania", "upenn.edu", "https://careers.upenn.edu", "Education", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 70 }],
  ["Princeton University", "princeton.edu", "https://main-princeton.icims.com", "Education", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 70 }],
  ["University of Chicago", "uchicago.edu", "https://jobopportunities.uchicago.edu", "Education", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 70 }],
  ["Duke University", "duke.edu", "https://careers.duke.edu", "Education", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 65 }],
  ["Northwestern University", "northwestern.edu", "https://www.northwestern.edu/hr/careers/", "Education", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 65 }],
  ["University of Michigan", "umich.edu", "https://careers.umich.edu", "Education", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 65 }],
  ["University of California System", "universityofcalifornia.edu", "https://careerspark.universityofcalifornia.edu", "Education", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 70 }],
  ["Johns Hopkins University", "jhu.edu", "https://hr.jhu.edu/careers/", "Education", "enterprise", { sponsors_h1b: true, sponsorship_confidence: 70 }],
]
