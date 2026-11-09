import { workoutModel } from '../shared/training.js'

const { isSideSet, isWarmupRow } = workoutModel

const DASH = '–'

// The engine marks a per-side set completed as soon as one side is done (for totals).
// This screen treats it as done only when both sides are.
export function isDone(slot) {
  const row = slot.row
  if (isSideSet(row)) return row.sides.L?.done === true && row.sides.R?.done === true
  return slot.completed === true
}

// A warm-up never counts: not in set numbers, the dock's set, rest, progress, the exercise the
// screen follows, carried weight or the finish count. The row decides, as volume and "Last time"
// read it: an explicit phase beats the old warmup flag.
export const isWarmup = slot => isWarmupRow(slot?.row)

const workSets = entry => (entry.sets || []).filter(slot => !isWarmup(slot))
const hasOpenWork = entry => workSets(entry).some(slot => !isDone(slot))

// Exactly one side of a per-side set logged.
const sideDoneOf = row => {
  if (!isSideSet(row)) return null
  const l = row.sides.L?.done === true
  const r = row.sides.R?.done === true
  return l === r ? null : l ? 'L' : 'R'
}
const halfDoneNow = entry => {
  const current = workSets(entry).find(slot => !isDone(slot))
  return current != null && sideDoneOf(current.row) !== null
}

// Which exercise is not stored, so a reopen picks it: one whose current set has one side done
// (a kill between the sides), else the first with a set left.
export function currentExerciseIndex(view) {
  const entries = view?.entries || []
  const half = entries.findIndex(halfDoneNow)
  if (half >= 0) return half
  const index = entries.findIndex(hasOpenWork)
  if (index >= 0) return index
  return Math.max(0, entries.length - 1)
}

// The weight a set with nothing logged yet opens at: the last done work set before it in the
// exercise (sets are done in order, so the latest lifted), as the web cascades a changed weight
// onto the sets after it. Undefined when there is none, or the set has a side or all of it
// logged, or it is a warm-up: its own weight stands. A draft weight still beats it.
export function carriedWeight(entry, setId) {
  let carried
  for (const slot of entry?.sets ?? []) {
    if (slot.setId === setId) {
      return isDone(slot) || sideDoneOf(slot.row) !== null || isWarmup(slot) ? undefined : carried
    }
    if (isWarmup(slot) || !isDone(slot)) continue
    const w = slot.row.w ?? slot.row.sides?.L?.w
    if (w != null) carried = w
  }
  return undefined
}

function num(value) {
  if (value == null || Number.isNaN(value)) return DASH
  return String(value)
}

// m:ss, or h:mm:ss from an hour up.
export function clock(ms) {
  const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = String(total % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

const countdown = ms => clock(Math.ceil(Math.max(0, Number(ms) || 0) / 1000) * 1000)

function nextSide(row) {
  return row.sides.L?.done === true ? 'R' : 'L'
}

// The numbers a set shows, and what one-tap Complete logs: the draft's fields, then `carry` from
// carriedWeight, then the row's. In the keypad's shape: { w, r }, or per side
// { w, sides: { L: { r }, R: { r } } } with the weight of the side being worked.
export function shownValues(slot, side, carry) {
  const { row } = slot
  const d = slot.draft || {}
  if (!isSideSet(row)) return { w: d.w ?? carry ?? row.w ?? null, r: d.r ?? row.r ?? null }
  const own = row.sides[side === 'R' ? 'R' : 'L']
  const reps = s => d.sides?.[s]?.r ?? d.r ?? row.sides[s].r ?? null
  return { w: d.w ?? carry ?? own.w ?? row.w ?? null, sides: { L: { r: reps('L') }, R: { r: reps('R') } } }
}

// One weight and one reps figure: per side, the reps of the side being worked.
function shown(slot, side, carry) {
  const v = shownValues(slot, side, carry)
  return { w: v.w, r: v.sides ? v.sides[side === 'R' ? 'R' : 'L'].r : v.r }
}

function repsText(slot) {
  const v = shownValues(slot, null)
  if (!v.sides) return num(v.r)
  const { L, R } = v.sides
  return L.r === R.r ? num(L.r) : `${num(L.r)} / ${num(R.r)}`
}

const lastLine = s => `${num(s.w)} × ${num(s.r)}`

// One line in a narrow column: per side, a shared weight is written once ("7.5 × 20/18").
function lastText(last, index) {
  const s = last && last.sets ? last.sets[index] : null
  if (!s) return DASH
  if (s.sides) {
    const { L, R } = s.sides
    return L.w === R.w ? `${num(L.w)} × ${num(L.r)}/${num(R.r)}` : `${lastLine(L)} / ${lastLine(R)}`
  }
  return lastLine(s)
}

function loadText(w, target) {
  return `${num(w)} lb${target?.dbLoad === 'each' ? ' each' : ''}`
}

function progressOf(entries) {
  let all = 0
  let finished = 0
  for (const entry of entries) {
    for (const slot of workSets(entry)) {
      all += 1
      if (isDone(slot)) finished += 1
    }
  }
  return all === 0 ? 0 : finished / all
}

function dockFor(view, entry, entries, index, current, number) {
  const rest = view.rest
  const resting = rest && (rest.status === 'running' || rest.status === 'paused')
  const target = entry?.target
  const side = current && isSideSet(current.row) ? nextSide(current.row) : null
  const figures = current ? shown(current, side, carriedWeight(entry, current.setId)) : null
  const figureText = figures ? `${loadText(figures.w, target)} × ${num(figures.r)}` : ''

  if (resting) {
    return {
      mode: 'resting',
      lead: countdown(rest.remainingMs),
      sub: current ? `Next: set ${number} · ${figureText}` : '',
      primaryLabel: '',
      setId: current ? current.setId : null,
      side,
    }
  }
  if (current) {
    // A set is never logged without a weight or reps: a blank one opens the keypad instead.
    // For a per-side set, the reps are those of the side being worked.
    const mode = figures.w == null ? 'enter-weight' : figures.r == null ? 'enter-reps' : 'ready'
    const label = mode === 'enter-weight' ? 'Enter weight'
      : mode === 'enter-reps' ? 'Enter reps'
        : side === 'L' ? 'Complete left'
          : side === 'R' ? 'Complete right'
            : `Complete set ${number}`
    return {
      mode,
      lead: `Set ${number} · ${figureText}`,
      sub: '',
      primaryLabel: label,
      setId: current.setId,
      side,
    }
  }
  const othersLeft = entries.some((other, i) => i !== index && hasOpenWork(other))
  return othersLeft
    ? { mode: 'exercise-done', lead: 'Exercise done', sub: '', primaryLabel: 'Next exercise', setId: null, side: null }
    : { mode: 'all-done', lead: 'All sets done', sub: '', primaryLabel: 'Finish workout', setId: null, side: null }
}

// `title` is the routine name; the engine view does not carry it, so the caller passes it.
export function workoutScreen(view, { names = {}, lastTimes = {}, exerciseIndex, title } = {}) {
  const entries = view?.entries || []
  const index = exerciseIndex === undefined ? currentExerciseIndex(view) : exerciseIndex
  const entry = entries[index] || { id: null, sets: [] }
  const info = names[entry.id]
  const last = lastTimes[entry.id] || null

  // Warm-ups show first, wherever the engine appended them, labelled W with no number and no
  // last time. Among themselves they go in order like work sets: the first open one is current.
  let warmCurrent = null
  const warmRows = (entry.sets || []).filter(isWarmup).map(slot => {
    const finished = isDone(slot)
    const isCurrent = !finished && warmCurrent === null
    if (isCurrent) warmCurrent = slot
    return {
      setId: slot.setId,
      number: null,
      label: 'W',
      weightText: num(shown(slot, null).w),
      repsText: repsText(slot),
      lastText: DASH,
      status: finished ? 'done' : isCurrent ? 'current' : 'pending',
      perSide: false,
      sideDone: null,
      warmup: true,
    }
  })

  let counter = 0
  const rows = []
  let current = null
  let currentNumber = 0
  for (const slot of workSets(entry)) {
    counter += 1
    const finished = isDone(slot)
    const isCurrent = !finished && current === null
    if (isCurrent) {
      current = slot
      currentNumber = counter
    }
    const perSide = isSideSet(slot.row)
    rows.push({
      setId: slot.setId,
      number: counter,
      label: String(counter),
      weightText: num(shown(slot, isCurrent && perSide ? nextSide(slot.row) : null, carriedWeight(entry, slot.setId)).w),
      repsText: repsText(slot),
      lastText: lastText(last, counter - 1),
      status: finished ? 'done' : isCurrent ? 'current' : 'pending',
      perSide,
      sideDone: sideDoneOf(slot.row),
      warmup: false,
    })
  }

  return {
    header: {
      title: title || 'Workout',
      exerciseNumber: index + 1,
      exerciseCount: entries.length,
      elapsedText: clock(view?.elapsedMs),
      progress: progressOf(entries),
    },
    card: {
      name: info ? info.name : `Unknown exercise (${entry.id})`,
      category: info ? info.category || '' : '',
      noHistory: last === null,
      rows: [...warmRows, ...rows],
    },
    dock: dockFor(view || {}, entry, entries, index, current, currentNumber),
  }
}
