/**
 * Time model, borrowed from Chronoglobe: astronomical years (1 BC = 0) so the
 * arithmetic has no gap, displayed with conventional BC / AD labels.
 */

export const BC = (bcYear: number): number => 1 - bcYear

export const MIN_YEAR = BC(4500)
export const MAX_YEAR = 2026

export function clampYear(y: number): number {
  return Math.min(MAX_YEAR, Math.max(MIN_YEAR, Math.round(y)))
}

export function formatYear(year: number, approx = false): string {
  const c = approx ? 'c. ' : ''
  if (year <= 0) return `${c}${1 - year} BC`
  if (year < 1000) return `${c}AD ${year}`
  return `${c}${year}`
}

export function formatYearShort(year: number): string {
  if (year <= 0) return `${1 - year} BC`
  return String(year)
}

/**
 * Non-linear scale. Language history is thin and reconstructed in the deep
 * past and dense in the last two millennia, so recent centuries get more room.
 * Piecewise-linear through [year, fraction] breakpoints.
 */
const BREAKPOINTS: Array<[number, number]> = [
  [MIN_YEAR, 0],
  [BC(2000), 0.2],
  [1, 0.42],
  [1000, 0.64],
  [1500, 0.8],
  [MAX_YEAR, 1],
]

export function yearToFraction(year: number): number {
  const y = Math.min(MAX_YEAR, Math.max(MIN_YEAR, year))
  for (let i = 1; i < BREAKPOINTS.length; i++) {
    const [y0, f0] = BREAKPOINTS[i - 1]
    const [y1, f1] = BREAKPOINTS[i]
    if (y <= y1) return f0 + ((y - y0) / (y1 - y0)) * (f1 - f0)
  }
  return 1
}

export function fractionToYear(f: number): number {
  const x = Math.min(1, Math.max(0, f))
  for (let i = 1; i < BREAKPOINTS.length; i++) {
    const [y0, f0] = BREAKPOINTS[i - 1]
    const [y1, f1] = BREAKPOINTS[i]
    if (x <= f1) return Math.round(y0 + ((x - f0) / (f1 - f0)) * (y1 - y0))
  }
  return MAX_YEAR
}

/** Ticks that read well on the non-linear axis. */
export const AXIS_TICKS: number[] = [
  BC(4500), BC(4000), BC(3000), BC(2000), BC(1500), BC(1000), BC(500),
  1, 500, 1000, 1250, 1500, 1750, 2000,
]

/** Step size for keyboard / scroll nudges, scaled to how compressed the axis is. */
export function stepAt(year: number): number {
  if (year < BC(2000)) return 50
  if (year < 1) return 25
  if (year < 1000) return 10
  return 5
}
