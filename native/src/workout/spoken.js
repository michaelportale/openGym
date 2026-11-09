import { primaryAction } from './set-calls.js'

// What VoiceOver says for the workout screen's dock, keypad fields and rows: numbers in words,
// never a dash or a symbol. Components pass these through and build no words of their own.

// The screen shows a dash for a blank value; numbers also work.
const isBlank = value => value == null || value === '' || value === '–'

const counted = (value, one, many) => `${value} ${String(value) === '1' ? one : many}`

// "75 pounds each", or null when there is no weight.
export function spokenWeight(value, { perHand = false } = {}) {
  if (isBlank(value)) return null
  return `${counted(value, 'pound', 'pounds')}${perHand ? ' each' : ''}`
}

// "8 reps", or null when there are none.
export function spokenReps(value) {
  return isBlank(value) ? null : counted(value, 'rep', 'reps')
}

// A per-side row's reps text is "20 / 18", or one figure when both sides match.
export function sideValues(text) {
  const [left, right = left] = String(text ?? '').split(' / ')
  return { L: left, R: right }
}

const FIELDS = { w: 'Weight', r: 'Reps', 'L.r': 'Left reps', 'R.r': 'Right reps' }

// A keypad field or an open row's box: 'w', 'r', or per side 'L.r'/'R.r', and the text it shows.
export function spokenField(field, value, { perHand = false } = {}) {
  if (!Object.hasOwn(FIELDS, field)) throw new Error(`Unknown field: ${field}`)
  if (isBlank(value)) return `${FIELDS[field]}, not set`
  if (field === 'w') return `Weight, ${spokenWeight(value, { perHand })}`
  if (field === 'r' && String(value).includes(' / ')) {
    const { L, R } = sideValues(value)
    const said = text => (isBlank(text) ? 'not set' : text)
    return `Reps, left ${said(L)}, right ${said(R)}`
  }
  return `${FIELDS[field]}, ${value}`
}

const UNITS = [[3600, 'hour'], [60, 'minute'], [1, 'second']]

// "1 minute 4 seconds", rounded up to the second as the countdown is.
export function spokenDuration(ms) {
  let left = Math.ceil(Math.max(0, Number(ms) || 0) / 1000)
  const parts = []
  for (const [size, unit] of UNITS) {
    const n = Math.floor(left / size)
    left -= n * size
    if (n > 0) parts.push(`${n} ${unit}${n === 1 ? '' : 's'}`)
  }
  return parts.length > 0 ? parts.join(' ') : '0 seconds'
}

const SIDES = { L: 'left side', R: 'right side' }
const SET_MODES = ['ready', 'enter-weight', 'enter-reps']

// "2, left side, 75 pounds each, 8 reps": the dock's set after the word "set".
function setWords({ number, figures, side }, perHand) {
  const which = Object.hasOwn(SIDES, side ?? '') ? `, ${SIDES[side]}` : ''
  const load = spokenWeight(figures.w, { perHand }) ?? 'weight not set'
  const count = spokenReps(figures.r) ?? 'reps not set'
  return `${number}${which}, ${load}, ${count}`
}

// The dock's lead in words. `dock` is `workoutScreen(...).dock` (or the screen's own overnight and
// unsaved docks, whose lead already says it).
export function spokenLead(dock, { perHand = false } = {}) {
  if (dock.mode === 'resting') {
    const rest = `Rest, ${spokenDuration(dock.remainingMs)} left`
    return dock.figures ? `${rest}. Next, set ${setWords(dock, perHand)}` : rest
  }
  if (SET_MODES.includes(dock.mode) && dock.figures) return `Set ${setWords(dock, perHand)}`
  return dock.lead
}

// Keyed to what set-calls routes the dock's main button to, so the hint cannot drift from it.
const PRIMARY_HINTS = {
  complete: 'Logs this set and starts the rest.',
  keypad: 'Opens the keypad.',
  follow: 'Shows the next exercise with sets left.',
  finish: 'Shows the summary before saving.'
}
// The screen's own docks, whose buttons set-calls does not route.
const SCREEN_HINTS = {
  overnight: 'Shows the summary, ending the workout at its last set.',
  finished: 'Shows the summary before saving.'
}

// The dock's main button hint for `mode`; undefined for a mode with no main button (resting).
// One side of a per-side set starts no rest: rest waits for both sides (rest-after.js).
export function spokenPrimaryHint(mode, { side = null } = {}) {
  if (Object.hasOwn(SCREEN_HINTS, mode)) return SCREEN_HINTS[mode]
  const action = primaryAction(mode)
  if (action === 'complete' && Object.hasOwn(SIDES, side ?? '')) return 'Logs this side. Rest starts once both sides are done.'
  return Object.hasOwn(PRIMARY_HINTS, action) ? PRIMARY_HINTS[action] : undefined
}

export function spokenUpNext(name) {
  if (typeof name !== 'string' || name.trim() === '') throw new Error('Up next needs a name')
  return `Up next, ${name}.`
}
