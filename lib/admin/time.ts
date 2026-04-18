export function startOfDay(date = new Date()) {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  ).toISOString()
}

export function startOfWeek(date = new Date()) {
  const copy = new Date(date)
  const day = copy.getUTCDay()
  const offset = day === 0 ? 6 : day - 1
  copy.setUTCDate(copy.getUTCDate() - offset)
  copy.setUTCHours(0, 0, 0, 0)
  return copy.toISOString()
}

export function subHours(hours: number, date = new Date()) {
  return new Date(date.getTime() - hours * 3_600_000).toISOString()
}
