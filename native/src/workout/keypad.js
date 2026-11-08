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

export function keypadState({ w = null, r = null, sides } = {}) {
  const sided = sides
    ? { L: { r: sides.L?.r ?? null }, R: { r: sides.R?.r ?? null } }
    : null
  return { field: 'w', entry: null, w: w ?? null, r: sided ? null : (r ?? null), sides: sided }
}

export function keypadValues(state) {
  const s = commit(state)
  if (isSided(s)) return { w: s.w, sides: { L: { r: s.sides.L.r }, R: { r: s.sides.R.r } } }
  return { w: s.w, r: s.r }
}

function type(state, key) {
  const text = state.entry ?? ''
  if (key === '.') {
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
  const s = commit(state)
  return { ...s, w: Math.max(0, (s.w ?? 0) + amount) }
}

function pick(state, field) {
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
