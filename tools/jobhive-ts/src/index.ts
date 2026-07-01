/**
 * jobhive-ts replica — registry entrypoint.
 *
 * Importing this module registers every ported scraper as a side-effect.
 * A faithful TypeScript port of the Python `jobhive` scrapers
 * (github.com/kalil0321/ats-scrapers), built to weigh head-to-head against
 * the hireoven harvester's own adapters.
 */

import "./scrapers/greenhouse.js"
import "./scrapers/lever.js"
import "./scrapers/ashby.js"
import "./scrapers/workable.js"
import "./scrapers/smartrecruiters.js"
import "./scrapers/personio.js"
import "./scrapers/recruitee.js"
import "./scrapers/teamtailor.js"
import "./scrapers/bamboohr.js"
import "./scrapers/workday.js"
import "./scrapers/oraclecloud.js"

export { getScraper, registeredAts } from "./base.js"
export type { ReplicaJob, ScrapeResult } from "./types.js"
