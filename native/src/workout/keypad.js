// Pure state for the keypad sheet. `entry` is the text being typed into the active field
// (null until a key is pressed, so the first digit replaces the old value). Values handed
// out by keypadValues are numbers or null, never strings.
const MAX_CHARS = 6

const isSided = state => state.sides !== null

const readField = (state, field) => {
  if (field === 'w') return state.w
  if (field === 'r') return state.r
  return state.sides[field[0]].r
}

const writeField = (state, field, value) => {
  if (field === 'w') return { ...state, w: value }
  if (field === 'r') return { ...state, r: value }
  const side = field[0]
  return { ...state, sides: { ...state.sides, [side]: { ...state.sides[side], r: value } } }
}

const parse = entry => (entry === '' || entry === '.' ? null : Number.parseFloat(entry))

// Folds the typed text into the numbers, leaving nothing half-typed.
function commit(state) {
  if (state.entry === null) return state
  return { ...writeField(state, state.field, parse(state.entry)), entry: null }
}

const validField = (field, sided) => (sided ? ['w', 'L.r', 'R.r'] : ['w', 'r']).includes(field)

const OTHER = { L: 'R', R: 'L' }

// `field` is the one the sheet opens on: 'w' by default, 'r' when the reps box was tapped.
// `weightSetWith` ('L' or 'R') is the side a half-done per-side set's weight was logged with:
// that weight is shared and stays (lockedWeight), so the weight field takes no input and the
// sheet opens on the other side's reps instead.
export function keypadState({ w = null, r = null, sides } = {}, field = 'w', { weightSetWith = null } = {}) {
  const sided = sides
    ? { L: { r: sides.L?.r ?? null }, R: { r: sides.R?.r ?? null } }
    : null
  const lock = sided && Object.hasOwn(OTHER, weightSetWith ?? '') ? weightSetWith : null
  const valid = validField(field, sided !== null) ? field : 'w'
  const opens = lock && valid === 'w' ? `${OTHER[lock]}.r` : valid
  return { field: opens, entry: null, w: w ?? null, r: sided ? null : (r ?? null), sides: sided, lock }
}

// The line under a weight set with the other side: 'Set with the left side.', or null.
export function weightLockNote(side) {
  return side === 'L' ? 'Set with the left side.' : side === 'R' ? 'Set with the right side.' : null
}

export function keypadValues(state) {
  const s = commit(state)
  if (isSided(s)) return { w: s.w, sides: { L: { r: s.sides.L.r }, R: { r: s.sides.R.r } } }
  return { w: s.w, r: s.r }
}

function type(state, key) {
  const text = state.entry ?? ''
  if (key === '.') {
    if (state.field !== 'w') return state // reps are whole numbers
    if (state.entry !== null && text.includes('.')) return state
    return { ...state, entry: state.entry === null || text === '' ? '0.' : `${text}.` }
  }
  if (state.entry === null) return { ...state, entry: key }
  if (text.length >= MAX_CHARS) return state
  return { ...state, entry: text + key }
}

function back(state) {
  const text = state.entry ?? String(readField(state, state.field) ?? '')
  return { ...state, entry: text.slice(0, -1) }
}

function chip(state, amount) {
  if (state.lock) return state
  const s = commit(state)
  return { ...s, w: Math.round(Math.max(0, (s.w ?? 0) + amount) * 1000) / 1000 }
}

function pick(state, field) {
  if (field === 'w' && state.lock) return state
  if (field !== 'w' && field !== 'r' && !/^[LR]\.r$/.test(field)) return state
  if (field === 'r' ? isSided(state) : field !== 'w' && !isSided(state)) return state
  return { ...commit(state), field }
}

export function applyKey(state, key) {
  if (/^[0-9]$/.test(key) || key === '.') {
    return type(state, key)
  }
  if (key === 'back') return back(state)
  if (key.startsWith('chip:')) {
    const amount = Number(key.slice(5))
    return Number.isFinite(amount) ? chip(state, amount) : state
  }
  if (key.startsWith('field:')) return pick(state, key.slice(6))
  return state
}

// Why Complete must wait: 'weight' when it is blank, 'reps' when the set's reps (per side, the
// side being completed) are blank, else null. A set is never logged without both.
export function completeBlocker(values, side) {
  if (values?.w == null) return 'weight'
  const reps = side === 'L' || side === 'R' ? values.sides?.[side]?.r : values.r
  return reps == null ? 'reps' : null
}

// Dynamic Type, as React Native's font scale: x1 is the default size, x1.353 the largest standard
// size, x1.786 the first accessibility size (AX1) and x3.571 the largest (AX5). From AX1 on, the
// button style (17 pt, up to x2.5) is about 30 pt or more, and half the row on a 375 to 393 pt
// wide iPhone no longer holds "Complete" on one line: the word breaks inside itself. So from there
// Save and Complete stack, each the full width; below it they share the row as they always have.
export const STACK_ACTIONS_FROM = 1.5

export function actionsStacked(fontScale) {
  return Number.isFinite(fontScale) && fontScale >= STACK_ACTIONS_FROM
}

const SIDE_COMPLETE = { L: 'Complete left', R: 'Complete right' }

// The sheet's Complete button: `label` is what it shows, `spoken` what VoiceOver says. A warm-up
// shows plain "Complete", which fits on one line in half the row at the default text size (the
// sheet's title already says Warm-up), and is spoken "Complete warm-up". `side` is the side a
// per-side set's Complete logs; `number` the work set's number.
export function completeLabels({ side = null, warmup = false, number = null } = {}) {
  const sided = Object.hasOwn(SIDE_COMPLETE, side ?? '') ? SIDE_COMPLETE[side] : null
  if (sided) return { label: sided, spoken: sided }
  if (warmup) return { label: 'Complete', spoken: 'Complete warm-up' }
  const text = `Complete set ${number}`
  return { label: text, spoken: text }
}

// 'save' when the sheet closes with different numbers than it opened with.
export function sheetCloseAction(initial, state) {
  return JSON.stringify(keypadValues(initial)) === JSON.stringify(keypadValues(state)) ? 'none' : 'save'
}

// What a field shows: the text mid-typing (so "7." stays visible), else the value, else a dash.
export function fieldText(state, field) {
  if (state.entry !== null && state.field === field) return state.entry === '' ? '–' : state.entry
  const value = readField(state, field)
  return value == null ? '–' : String(value)
}
