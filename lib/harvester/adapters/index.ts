import type { AtsAdapter, AtsName } from "@/lib/harvester/adapters/_base"
import { ashbyAdapter } from "@/lib/harvester/adapters/ashby"
import { bamboohrAdapter } from "@/lib/harvester/adapters/bamboohr"
import { appleAdapter } from "@/lib/harvester/adapters/apple"
import { ripplingAdapter } from "@/lib/harvester/adapters/rippling"
import { greenhouseAdapter } from "@/lib/harvester/adapters/greenhouse"
import { icimsAdapter } from "@/lib/harvester/adapters/icims"
import { infosysAdapter } from "@/lib/harvester/adapters/infosys"
import { jazzhrAdapter } from "@/lib/harvester/adapters/jazzhr"
import { jobviteAdapter } from "@/lib/harvester/adapters/jobvite"
import { leverAdapter } from "@/lib/harvester/adapters/lever"
import { oraclecloudAdapter } from "@/lib/harvester/adapters/oraclecloud"
import { smartrecruitersAdapter } from "@/lib/harvester/adapters/smartrecruiters"
import { personioAdapter } from "@/lib/harvester/adapters/personio"
import { recruiteeAdapter } from "@/lib/harvester/adapters/recruitee"
import { successfactorsAdapter } from "@/lib/harvester/adapters/successfactors"
import { taleoAdapter } from "@/lib/harvester/adapters/taleo"
import { teamtailorAdapter } from "@/lib/harvester/adapters/teamtailor"
import { usajobsAdapter } from "@/lib/harvester/adapters/usajobs"
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
  jazzhr: jazzhrAdapter,
  jobvite: jobviteAdapter,
  icims: icimsAdapter,
  successfactors: successfactorsAdapter,
  taleo: taleoAdapter,
  oraclecloud: oraclecloudAdapter,
  usajobs: usajobsAdapter,
  infosys: infosysAdapter,
  apple: appleAdapter,
  rippling: ripplingAdapter,
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
