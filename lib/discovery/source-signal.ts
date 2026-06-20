/**
 * A SourceSignal is the normalized output of every "company is hiring" feed
 * (Snagajob, Dice, HN Who-is-Hiring, BuiltIn, …) — the front of the discovery
 * flow described in the harvester design:
 *
 *   board signal {name, location} → official domain → career page
 *     → ATS detect → US/Canada verify → confidence → enroll / hold
 *
 * Feed adapters in lib/sources/* emit SourceSignals; resolveCareerSource()
 * turns each one into a scored, persistable career source. Adapters do NOT
 * touch the DB or the ATS — they only normalize what their board exposes.
 */
export type SourceSignal = {
  /** Employer name as the board reports it. Required — it's the only field
   *  every aggregator guarantees. */
  companyName: string
  /** Real website/domain when the board exposes one (BuiltIn does; Dice and
   *  pure aggregators do not). Lets resolveDomain() skip the guess step. */
  domainHint?: string | null
  /** A sample job title — not used for resolution, only carried into the
   *  candidate row for debugging / later auditing. */
  sampleTitle?: string | null
  /** A sample job location string ("Austin, TX", "Remote") used as a cheap
   *  first US/Canada-confirmation signal before any career-page fetch. */
  sampleLocation?: string | null
  /** Channel id for discovery_runs / discovered_candidates.source, e.g.
   *  "snagajob", "dice", "hn-whoishiring". */
  source: string
}

/** A feed adapter pulls its board and yields normalized signals. */
export type SourceFeed = {
  /** Stable channel id, also used as discovered_candidates.source. */
  channel: string
  /** Fetch the board and return de-duplicated signals for this run. */
  fetchSignals: (options?: { maxSignals?: number; signal?: AbortSignal }) => Promise<SourceSignal[]>
}
