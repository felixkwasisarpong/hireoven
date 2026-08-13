import type { ActionableAccessRoute } from "./types"

export function validAccessRoutes(routes: ActionableAccessRoute[]): ActionableAccessRoute[] {
  return [...routes]
    .filter(isValidAccessRoute)
    .sort((a, b) => routeRank(a) - routeRank(b) || a.id.localeCompare(b.id))
}

export function isValidAccessRoute(route: ActionableAccessRoute): boolean {
  return Boolean(
    route.id &&
    route.channel &&
    route.relationshipContext.trim() &&
    route.nextStep.trim() &&
    route.sourceFactIds.length > 0 &&
    route.stale === false,
  )
}

function routeRank(route: ActionableAccessRoute): number {
  switch (route.routeType) {
    case "direct_connection":
      return 0
    case "employer_recruiter_contact":
      return 1
    case "second_degree_connection":
      return 2
    case "company_alumni":
      return 3
    case "cohort_peer":
      return 4
    case "candidate_supplied_contact":
      return 5
  }
}
