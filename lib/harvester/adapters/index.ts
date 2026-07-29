import type { AtsAdapter, AtsName } from "@/lib/harvester/adapters/_base"
import { ashbyAdapter } from "@/lib/harvester/adapters/ashby"
import { bamboohrAdapter } from "@/lib/harvester/adapters/bamboohr"
import { breezyAdapter } from "@/lib/harvester/adapters/breezy"
import { appleAdapter } from "@/lib/harvester/adapters/apple"
import { amazonAdapter } from "@/lib/harvester/adapters/amazon"
import { walmartAdapter } from "@/lib/harvester/adapters/walmart"
import { microsoftAdapter } from "@/lib/harvester/adapters/microsoft"
import { netflixAdapter } from "@/lib/harvester/adapters/netflix"
import { ripplingAdapter } from "@/lib/harvester/adapters/rippling"
import { ripplingAlgoliaAdapter } from "@/lib/harvester/adapters/rippling-algolia"
import { goldmanSachsAdapter } from "@/lib/harvester/adapters/goldman-sachs"
import { eightfoldAdapter } from "@/lib/harvester/adapters/eightfold"
import { zohoRecruitAdapter } from "@/lib/harvester/adapters/zohorecruit"
import { adpAdapter } from "@/lib/harvester/adapters/adp"
import { teamworkOnlineAdapter } from "@/lib/harvester/adapters/teamworkonline"
import { jsonldAdapter } from "@/lib/harvester/adapters/jsonld"
import { sitemapJsonLdAdapter } from "@/lib/harvester/adapters/sitemap-jsonld"
import { radancyAdapter } from "@/lib/harvester/adapters/radancy"
import { jobs2webAdapter } from "@/lib/harvester/adapters/jobs2web"
import { tiktokAdapter } from "@/lib/harvester/adapters/tiktok"
import { googleAdapter } from "@/lib/harvester/adapters/google"
import { greenhouseAdapter } from "@/lib/harvester/adapters/greenhouse"
import { icimsAdapter } from "@/lib/harvester/adapters/icims"
import { infosysAdapter } from "@/lib/harvester/adapters/infosys"
import { ibmAdapter } from "@/lib/harvester/adapters/ibm"
import { adeccoAdapter } from "@/lib/harvester/adapters/adecco"
import { kellyAdapter } from "@/lib/harvester/adapters/kelly"
import { jazzhrAdapter } from "@/lib/harvester/adapters/jazzhr"
import { jobviteAdapter } from "@/lib/harvester/adapters/jobvite"
import { leverAdapter } from "@/lib/harvester/adapters/lever"
import { oraclecloudAdapter } from "@/lib/harvester/adapters/oraclecloud"
import { smartrecruitersAdapter } from "@/lib/harvester/adapters/smartrecruiters"
import { personioAdapter } from "@/lib/harvester/adapters/personio"
import { pinpointAdapter } from "@/lib/harvester/adapters/pinpoint"
import { recruiterboxAdapter } from "@/lib/harvester/adapters/recruiterbox"
import { gemAdapter } from "@/lib/harvester/adapters/gem"
import { cornerstoneAdapter } from "@/lib/harvester/adapters/cornerstone"
import { recruiteeAdapter } from "@/lib/harvester/adapters/recruitee"
import { successfactorsAdapter } from "@/lib/harvester/adapters/successfactors"
import { taleoAdapter } from "@/lib/harvester/adapters/taleo"
import { teamtailorAdapter } from "@/lib/harvester/adapters/teamtailor"
import { usajobsAdapter } from "@/lib/harvester/adapters/usajobs"
import { neogovAdapter } from "@/lib/harvester/adapters/neogov"
import { euresAdapter } from "@/lib/harvester/adapters/eures"
import { ukfindajobAdapter } from "@/lib/harvester/adapters/ukfindajob"
import { canadajobbankAdapter } from "@/lib/harvester/adapters/canadajobbank"
import { fountainAdapter } from "@/lib/harvester/adapters/fountain"
import { paylocityAdapter } from "@/lib/harvester/adapters/paylocity"
import { paycomAdapter } from "@/lib/harvester/adapters/paycom"
import { dayforceAdapter } from "@/lib/harvester/adapters/dayforce"
import { phenomAdapter } from "@/lib/harvester/adapters/phenom"
import { avatureAdapter } from "@/lib/harvester/adapters/avature"
import { ukgAdapter } from "@/lib/harvester/adapters/ukg"
import { workableAdapter } from "@/lib/harvester/adapters/workable"
import { workdayAdapter } from "@/lib/harvester/adapters/workday"

export const adapters: Partial<Record<AtsName, AtsAdapter>> = {
  greenhouse: greenhouseAdapter,
  lever: leverAdapter,
  ashby: ashbyAdapter,
  smartrecruiters: smartrecruitersAdapter,
  workable: workableAdapter,
  workday: workdayAdapter,
  recruitee: recruiteeAdapter,
  teamtailor: teamtailorAdapter,
  personio: personioAdapter,
  bamboohr: bamboohrAdapter,
  pinpoint: pinpointAdapter,
  recruiterbox: recruiterboxAdapter,
  gem: gemAdapter,
  cornerstone: cornerstoneAdapter,
  breezy: breezyAdapter,
  jazzhr: jazzhrAdapter,
  jobvite: jobviteAdapter,
  icims: icimsAdapter,
  successfactors: successfactorsAdapter,
  taleo: taleoAdapter,
  oraclecloud: oraclecloudAdapter,
  usajobs: usajobsAdapter,
  neogov: neogovAdapter,
  eures: euresAdapter,
  ukfindajob: ukfindajobAdapter,
  canadajobbank: canadajobbankAdapter,
  fountain: fountainAdapter,
  paylocity: paylocityAdapter,
  paycom: paycomAdapter,
  dayforce: dayforceAdapter,
  phenom: phenomAdapter,
  avature: avatureAdapter,
  ukg: ukgAdapter,
  infosys: infosysAdapter,
  ibm: ibmAdapter,
  adecco: adeccoAdapter,
  kelly: kellyAdapter,
  apple: appleAdapter,
  amazon: amazonAdapter,
  walmart: walmartAdapter,
  microsoft: microsoftAdapter,
  netflix: netflixAdapter,
  rippling: ripplingAdapter,
  "rippling-algolia": ripplingAlgoliaAdapter,
  "goldman-sachs": goldmanSachsAdapter,
  eightfold: eightfoldAdapter,
  zohorecruit: zohoRecruitAdapter,
  adp: adpAdapter,
  teamworkonline: teamworkOnlineAdapter,
  jsonld: jsonldAdapter,
  sitemapjsonld: sitemapJsonLdAdapter,
  radancy: radancyAdapter,
  jobs2web: jobs2webAdapter,
  tiktok: tiktokAdapter,
  google: googleAdapter,
}

export function getAdapter(name: AtsName): AtsAdapter | undefined {
  return adapters[name]
}

export function detectAdapter(url: string): { adapter: AtsAdapter; slug: string } | null {
  for (const adapter of Object.values(adapters)) {
    if (!adapter) continue
    const detection = adapter.detectFromUrl(url)
    if (detection) return { adapter, slug: detection.slug }
  }
  return null
}

/** Names of all adapters currently wired up. Used by the worker's claim filter. */
export function registeredAdapterNames(): AtsName[] {
  return Object.entries(adapters)
    .filter(([, adapter]) => Boolean(adapter))
    .map(([name]) => name as AtsName)
}

export type { AtsAdapter, AtsName, HarvestCtx, HarvestResult, HarvestedJob } from "@/lib/harvester/adapters/_base"
