const STATUSES = {
  done: { marker: 'checked', fields: 'plain', spoken: 'completed' },
  current: { marker: 'open', fields: 'boxed', spoken: 'current set' },
  pending: { marker: 'empty', fields: 'plain', spoken: 'not started' }
}

// The screen passes display strings ('–' for blank, '20 / 18' for per-side reps); numbers also work.
const isBlank = value => value == null || value === '–'

const spokenAmount = (value, one, many, unset) => {
  if (isBlank(value)) return unset
  return `${value} ${String(value) === '1' ? one : many}`
}

// `lastText` is last time's line for this set ("75 × 10"); a dash or nothing means no history.
const spokenLast = lastText => {
  if (!lastText || lastText === '–') return ''
  return `, last time ${lastText.replaceAll(' × ', ' by ')}`
}

export function setRowView({ number, weight, reps, status, lastText }) {
  if (!Object.hasOwn(STATUSES, status)) throw new Error(`Unknown set status: ${status}`)
  const { marker, fields, spoken } = STATUSES[status]
  const load = spokenAmount(weight, 'pound', 'pounds', 'no weight')
  const count = spokenAmount(reps, 'rep', 'reps', 'no reps')
  return {
    marker,
    fields,
    weightText: isBlank(weight) ? '–' : String(weight),
    repsText: isBlank(reps) ? '–' : String(reps),
    lastText: lastText || '–',
    accessibilityLabel: `Set ${number}, ${load}, ${count}, ${spoken}${status === 'done' ? '' : spokenLast(lastText)}`
  }
}
