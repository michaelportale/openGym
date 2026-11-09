import { workoutModel } from '../shared/training.js'

const { isSideSet } = workoutModel

const DASH = '–'

// The engine marks a per-side set completed as soon as one side is done (for totals).
// This screen treats it as done only when both sides are.
export function isDone(slot) {
  const row = slot.row
  if (isSideSet(row)) return row.sides.L?.done === true && row.sides.R?.done === true
  return slot.completed === true
}

const workSets = entry => (entry.sets || []).filter(slot => !slot.warmup)
const hasOpenWork = entry => workSets(entry).some(slot => !isDone(slot))

export function currentExerciseIndex(view) {
  const entries = view?.entries || []
  const index = entries.findIndex(hasOpenWork)
  if (index >= 0) return index
  return Math.max(0, entries.length - 1)
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

// The numbers a row shows: the draft's fields over the row's. A per-side row shows the
// side being worked (or both sides' reps once neither is pending).
function shown(slot, side) {
  const { row, draft } = slot
  const d = draft || {}
  if (isSideSet(row)) {
    const own = side ? row.sides[side] : row.sides.L
    const dSide = side && d.sides && d.sides[side] ? d.sides[side] : {}
    return {
      w: dSide.w ?? d.w ?? own.w ?? row.w,
      r: dSide.r ?? d.r ?? own.r,
    }
  }
  return { w: d.w ?? row.w, r: d.r ?? row.r }
}

function repsText(slot) {
  const { row, draft } = slot
  if (isSideSet(row) && !draft?.r) {
    const l = draft?.sides?.L?.r ?? row.sides.L?.r
    const r = draft?.sides?.R?.r ?? row.sides.R?.r
    return l === r ? num(l) : `${num(l)} / ${num(r)}`
  }
  return num(shown(slot, null).r)
}

const lastLine = s => `${num(s.w)} × ${num(s.r)}`

function lastText(last, index) {
  const s = last && last.sets ? last.sets[index] : null
  if (!s) return DASH
  if (s.sides) return `${lastLine(s.sides.L)} / ${lastLine(s.sides.R)}`
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
  const figures = current ? shown(current, side) : null
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
    const blank = figures.w == null
    const label = blank ? 'Enter weight'
      : side === 'L' ? 'Complete left'
        : side === 'R' ? 'Complete right'
          : `Complete set ${number}`
    return {
      mode: blank ? 'enter-weight' : 'ready',
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

  let counter = 0
  const rows = []
  let current = null
  let currentNumber = 0
  for (const slot of entry.sets || []) {
    if (slot.warmup) continue
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
      weightText: num(shown(slot, isCurrent && perSide ? nextSide(slot.row) : null).w),
      repsText: repsText(slot),
      lastText: lastText(last, counter - 1),
      status: finished ? 'done' : isCurrent ? 'current' : 'pending',
      perSide,
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
      rows,
    },
    dock: dockFor(view || {}, entry, entries, index, current, currentNumber),
  }
}
