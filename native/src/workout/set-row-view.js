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

// A per-side set with one side logged is not done yet; its done column marks that side.
const SIDE_MARKS = {
  L: { text: 'L ✓', label: 'Left side done' },
  R: { text: 'R ✓', label: 'Right side done' }
}

// `sideDone` is 'L' or 'R' when exactly one side of a per-side set is logged.
export function setRowView({ number, weight, reps, status, lastText, sideDone }) {
  if (!Object.hasOwn(STATUSES, status)) throw new Error(`Unknown set status: ${status}`)
  const { marker, fields, spoken } = STATUSES[status]
  const load = spokenAmount(weight, 'pound', 'pounds', 'no weight')
  const count = spokenAmount(reps, 'rep', 'reps', 'no reps')
  const sideMark = status !== 'done' && Object.hasOwn(SIDE_MARKS, sideDone ?? '') ? SIDE_MARKS[sideDone] : null
  const side = sideMark ? `, ${sideMark.label.toLowerCase()}` : ''
  return {
    marker,
    fields,
    sideMark,
    weightText: isBlank(weight) ? '–' : String(weight),
    repsText: isBlank(reps) ? '–' : String(reps),
    lastText: lastText || '–',
    accessibilityLabel: `Set ${number}, ${load}, ${count}, ${spoken}${side}${status === 'done' ? '' : spokenLast(lastText)}`
  }
}
