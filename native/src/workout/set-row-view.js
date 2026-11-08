const STATUSES = {
  done: { marker: 'checked', fields: 'plain', spoken: 'completed' },
  active: { marker: 'open', fields: 'boxed', spoken: 'current set' },
  pending: { marker: 'empty', fields: 'plain', spoken: 'not started' }
}

const spokenAmount = (value, one, many, unset) => {
  if (value == null) return unset
  return `${value} ${value === 1 ? one : many}`
}

export function setRowView({ number, weight, reps, status }) {
  if (!Object.hasOwn(STATUSES, status)) throw new Error(`Unknown set status: ${status}`)
  const { marker, fields, spoken } = STATUSES[status]
  const load = spokenAmount(weight, 'pound', 'pounds', 'no weight')
  const count = spokenAmount(reps, 'rep', 'reps', 'no reps')
  return {
    marker,
    fields,
    weightText: weight == null ? '–' : String(weight),
    repsText: reps == null ? '–' : String(reps),
    accessibilityLabel: `Set ${number}, ${load}, ${count}, ${spoken}`
  }
}
