import { sideValues, spokenField, spokenReps, spokenWeight } from './spoken.js'

const STATUSES = {
  done: { marker: 'checked', fields: 'plain', spoken: 'completed' },
  current: { marker: 'open', fields: 'boxed', spoken: 'current set' },
  pending: { marker: 'empty', fields: 'plain', spoken: 'not started' }
}

// A warm-up is done or open. Only the dock's work set is current, so the first open warm-up's
// numbers sit in filled boxes without the current set's border or marker, and it is never
// "current set".
const WARMUP_STATUSES = {
  done: { marker: 'checked', fields: 'plain', spoken: 'done' },
  current: { marker: 'empty', fields: 'filled', spoken: 'open' },
  pending: { marker: 'empty', fields: 'plain', spoken: 'open' }
}

// The screen passes display strings ('–' for blank, '20 / 18' for per-side reps); numbers also work.
const isBlank = value => value == null || value === '–'

// `lastText` is last time's line for this set ("75 × 10"); a dash or nothing means no history.
const spokenLast = lastText => {
  if (!lastText || lastText === '–') return ''
  return `, last time ${lastText.replaceAll(' × ', ' by ')}`
}

// A per-side set with one side logged is not done yet; its done column marks that side.
const SIDE_MARKS = { L: 'L ✓', R: 'R ✓' }
const SIDE_NAMES = [['L', 'Left'], ['R', 'Right']]

// "Left, 20 reps, done, Right, 18 reps": each side's reps, and which one is logged.
const spokenSides = (reps, doneSide) => {
  const values = sideValues(reps)
  return SIDE_NAMES.map(([side, name]) => `${name}, ${spokenReps(values[side]) ?? 'reps not set'}${side === doneSide ? ', done' : ''}`).join(', ')
}

// `sideDone` is 'L' or 'R' when exactly one side of a per-side set is logged. A `warmup` row has
// no number: it is spoken as "Warm-up" and has no last time. `perHand` adds "each" to the weight.
// The label carries last time, so an open row needs no stop of its own for the Last column.
export function setRowView({ number, weight, reps, status, lastText, sideDone, warmup = false, perSide = false, perHand = false }) {
  const statuses = warmup ? WARMUP_STATUSES : STATUSES
  if (!Object.hasOwn(statuses, status)) throw new Error(`Unknown set status: ${status}`)
  const { marker, fields, spoken } = statuses[status]
  const marked = status !== 'done' && Object.hasOwn(SIDE_MARKS, sideDone ?? '') ? sideDone : null
  const load = spokenWeight(weight, { perHand }) ?? 'weight not set'
  const count = perSide || marked ? spokenSides(reps, marked) : spokenReps(reps) ?? 'reps not set'
  const name = warmup ? 'Warm-up' : `Set ${number}`
  const last = status === 'done' || warmup ? '' : spokenLast(lastText)
  return {
    marker,
    fields,
    sideMark: marked ? { text: SIDE_MARKS[marked] } : null,
    weightText: isBlank(weight) ? '–' : String(weight),
    repsText: isBlank(reps) ? '–' : String(reps),
    lastText: lastText || '–',
    accessibilityLabel: `${name}, ${load}, ${count}, ${spoken}${last}`,
    weightLabel: spokenField('w', weight, { perHand }),
    repsLabel: spokenField('r', reps)
  }
}
