export const RANGES = [
  { label: '1M', days: 30 },
  { label: '3M', days: 90 },
  { label: '1Y', days: 365 },
  { label: 'All', days: 0 },
]

// What a screen reader hears for the body-weight chart.
export function chartLabel(range, averageLine) {
  const span = range === 0 ? 'all time' : `last ${range} days`
  return `Body weight, ${span}` + (averageLine ? `: ${averageLine}` : '')
}
