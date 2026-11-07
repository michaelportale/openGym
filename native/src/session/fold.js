import { finishWorkout, workoutModel } from '../shared/training.js'
import { DURATION_GAP_MS, REST_MAX_MS, clampMs, elapsedMs, isOvernight, projectRest } from './timing.js'
import { plannedSetId } from './ids.js'

const { buildCompletedWorkout, sessionEnd } = finishWorkout
const { hasCompletedWork, isSideSet } = workoutModel

function clone(value) {
  // Plain JSON only. Hermes on device may not provide structuredClone.
  return value == null ? value : JSON.parse(JSON.stringify(value))
}

export function activityAt(model) {
  for (let i = model.stamps.length - 1; i >= 0; i -= 1) {
    if (Number.isFinite(model.stamps[i])) return model.stamps[i]
  }
  return Number.isFinite(model.start) ? model.start : null
}

function blankModel(base) {
  const src = base && typeof base === 'object' ? clone(base) : {}
  const entries = Array.isArray(src.entries) ? src.entries : []
  return {
    base: src,
    start: Number.isFinite(src.start) ? src.start : null,
    entries: entries.map((entry, index) => {
      const id = entry && entry.id != null ? entry.id : `entry:${index}`
      const sets = Array.isArray(entry?.sets) ? entry.sets : []
      return {
        source: entry,
        id,
        sets: sets.map((set, setIndex) => ({
          setId: set && set.id != null ? String(set.id) : plannedSetId(id, setIndex),
          row: set && typeof set === 'object' ? clone(set) : {},
        })),
      }
    }),
    rest: null,
    finished: null,
    stamps: [],
  }
}

function findEntry(model, exerciseId) {
  return model.entries.find(entry => entry.id === exerciseId) || null
}

function findSlot(model, exerciseId, setId) {
  const entry = findEntry(model, exerciseId)
  if (!entry) return null
  return entry.sets.find(slot => slot.setId === setId) || null
}

function mergeFields(row, fields) {
  const next = { ...row }
  for (const [key, value] of Object.entries(fields || {})) {
    if (key === 'at' || key === 'done') continue
    if (value === null) delete next[key]
    else next[key] = value
  }
  return next
}

function clearDone(row) {
  const next = { ...row, done: false }
  if (isSideSet(next)) {
    next.sides = {
      L: { ...next.sides.L, done: false },
      R: { ...next.sides.R, done: false },
    }
  }
  return next
}

function applyRestStart(model, event) {
  const deadline = Number(event.deadline)
  if (!Number.isFinite(deadline)) return
  const span = Math.max(0, deadline - (Number.isFinite(event.at) ? event.at : 0))
  const requested = Number.isFinite(event.totalMs) ? event.totalMs : span
  model.rest = {
    status: 'running',
    deadline,
    totalMs: Math.min(Math.max(requested, 0), REST_MAX_MS),
    remainingMs: null,
    pausedAt: null,
  }
}

function applyPause(model, event) {
  if (!model.rest || model.rest.status === 'paused') return
  const at = Number(event.at)
  if (!Number.isFinite(at)) return
  const remainingMs = clampMs(model.rest.deadline - at, model.rest.totalMs)
  model.rest = {
    status: 'paused',
    remainingMs,
    totalMs: model.rest.totalMs,
    deadline: at + remainingMs,
    pausedAt: at,
  }
}

function applyExtend(model, event) {
  if (!model.rest) return
  const byMs = Number(event.byMs)
  if (!Number.isFinite(byMs) || byMs === 0) return
  const room = Math.max(0, REST_MAX_MS - model.rest.totalMs)
  const applied = byMs > 0 ? Math.min(byMs, room) : byMs
  if (applied === 0) return
  const totalMs = Math.max(0, model.rest.totalMs + applied)
  if (model.rest.status === 'paused') {
    const remainingMs = Math.max(0, model.rest.remainingMs + applied)
    model.rest = {
      ...model.rest,
      remainingMs,
      totalMs,
      deadline: model.rest.deadline + applied,
    }
    return
  }
  model.rest = {
    ...model.rest,
    totalMs,
    deadline: model.rest.deadline + applied,
  }
}

function applyEvent(model, event) {
  switch (event.type) {
    case 'set.commit': {
      const slot = findSlot(model, event.exerciseId, event.setId)
      if (!slot) return
      const row = mergeFields(slot.row, event.fields)
      row.done = true
      row.at = event.at
      slot.row = row
      return
    }
    case 'set.edit': {
      const slot = findSlot(model, event.exerciseId, event.setId)
      if (!slot) return
      slot.row = mergeFields(slot.row, event.fields)
      return
    }
    case 'set.undo': {
      const slot = findSlot(model, event.exerciseId, event.setId)
      if (!slot) return
      slot.row = clearDone(slot.row)
      return
    }
    case 'set.remove': {
      const entry = findEntry(model, event.exerciseId)
      if (!entry || entry.sets.length <= 1) return
      const index = entry.sets.findIndex(slot => slot.setId === event.setId)
      if (index < 0) return
      entry.sets.splice(index, 1)
      return
    }
    case 'set.add': {
      const entry = findEntry(model, event.exerciseId)
      if (!entry || entry.sets.some(slot => slot.setId === event.setId)) return
      const row = mergeFields({}, event.fields)
      row.done = false
      entry.sets.push({ setId: event.setId, row })
      return
    }
    case 'exercise.add': {
      const id = event.exerciseId
      if (typeof id !== 'string' || id === '' || findEntry(model, id)) return
      const src = event.entry && typeof event.entry === 'object' && !Array.isArray(event.entry)
        ? clone(event.entry)
        : {}
      src.id = id
      const rawSets = Array.isArray(src.sets) && src.sets.length ? src.sets : [{}]
      delete src.sets
      const sets = rawSets.map((set, index) => {
        const row = set && typeof set === 'object' ? clone(set) : {}
        delete row.id
        row.done = false
        return {
          setId: set && set.id != null ? String(set.id) : plannedSetId(id, index),
          row,
        }
      })
      model.entries.push({ source: src, id, sets })
      return
    }
    case 'exercise.remove': {
      if (model.entries.length <= 1) return
      const index = model.entries.findIndex(entry => entry.id === event.exerciseId)
      if (index < 0) return
      model.entries.splice(index, 1)
      return
    }
    case 'exercise.move': {
      const from = model.entries.findIndex(entry => entry.id === event.exerciseId)
      if (from < 0 || !Number.isInteger(event.toIndex)) return
      const [entry] = model.entries.splice(from, 1)
      const index = Math.max(0, Math.min(event.toIndex, model.entries.length))
      model.entries.splice(index, 0, entry)
      return
    }
    case 'rest.start':
      applyRestStart(model, event)
      return
    case 'rest.pause':
      applyPause(model, event)
      return
    case 'rest.extend':
      applyExtend(model, event)
      return
    case 'rest.cancel':
      model.rest = null
      return
    case 'session.resume':
      return
    case 'session.finish':
      model.finished = { at: event.at, end: event.end }
      model.rest = null
      return
    default:
      return
  }
}

// Replay is idempotent on event id. The first session.finish seals the log: later events keep
// their ids (so a duplicate still no-ops) but do not change sets, rest, or the finished end.
export function foldJournal(base, events) {
  const model = blankModel(base)
  const seen = new Set()
  for (const event of events || []) {
    if (!event || event.id == null || seen.has(event.id)) continue
    seen.add(event.id)
    if (model.finished) continue
    applyEvent(model, event)
    if (Number.isFinite(event.at)) model.stamps.push(event.at)
  }
  return model
}

export function toActive(model) {
  const base = clone(model.base || {})
  const entries = model.entries.map(entry => {
    const src = clone(entry.source || {})
    delete src.sets
    if (entry.id != null) src.id = entry.id
    return {
      ...src,
      sets: entry.sets.map(slot => clone(slot.row)),
    }
  })
  return { ...base, entries }
}

function preserveUnknown(active, completed) {
  const out = { ...completed }
  for (const [key, value] of Object.entries(active)) {
    if (key === 'entries') continue
    if (!Object.prototype.hasOwnProperty.call(completed, key)) out[key] = clone(value)
  }
  out.entries = (completed.entries || []).map(entry => {
    const src = (active.entries || []).find(item => item.id === entry.id) || {}
    const merged = { ...entry }
    for (const [key, value] of Object.entries(src)) {
      if (key === 'sets') continue
      if (!Object.prototype.hasOwnProperty.call(entry, key)) merged[key] = clone(value)
    }
    return merged
  })
  return out
}

export function finishedDocument(model) {
  if (!model.finished) return null
  const active = toActive(model)
  const prs = Array.isArray(active.prs) ? active.prs : []
  const completed = buildCompletedWorkout(active, { end: model.finished.end, prs })
  return preserveUnknown(active, completed)
}

function warmupFlag(row) {
  if (!row || typeof row !== 'object') return false
  if (row.warmup === true) return true
  const phase = typeof row.phase === 'string' ? row.phase.trim().toLowerCase() : ''
  return phase === 'warmup' || phase === 'warm-up' || phase === 'warm_up'
}

function repsOf(row) {
  if (!hasCompletedWork(row)) return 0
  if (isSideSet(row)) {
    return [row.sides.L, row.sides.R]
      .filter(side => side?.done === true)
      .reduce((total, side) => total + (Number(side.r) || 0), 0)
  }
  return Number(row.r) || 0
}

function loadRepsOf(row) {
  if (!hasCompletedWork(row)) return 0
  if (isSideSet(row)) {
    return [row.sides.L, row.sides.R]
      .filter(side => side?.done === true)
      .reduce((total, side) => total + (Number(side.w) || 0) * (Number(side.r) || 0), 0)
  }
  return (Number(row.w) || 0) * (Number(row.r) || 0)
}

export function projectSession(model, { now, timeZone, drafts, discarded, samples }) {
  if (discarded) {
    return {
      status: 'discarded',
      timeZone,
      startedAt: null,
      elapsedMs: 0,
      overnight: false,
      disposition: { kind: 'discarded', actions: [], suggestedEnd: null },
      rest: null,
      entries: [],
      totals: { completedSets: 0, reps: 0, loadReps: 0, warmupSets: 0 },
      finished: null,
    }
  }

  const finished = finishedDocument(model)
  const active = toActive(model)
  const suggested = sessionEnd(active, now)
  const activity = activityAt(model)
  const overnight = !finished && isOvernight(activity, now, timeZone)
  const clockEnd = finished ? finished.end : now
  // Samples are now() values this process has already shown. They are not journal events.
  // A later clock step cannot erase time the live session already displayed. A restarted
  // process has only the journal, which is the durable source.
  const stamps = []
  if (Number.isFinite(model.start)) stamps.push(model.start)
  for (const stamp of model.stamps) {
    if (!finished || stamp <= finished.end) stamps.push(stamp)
  }
  for (const sample of samples || []) {
    if (!finished || sample <= finished.end) stamps.push(sample)
  }

  let completedSets = 0
  let reps = 0
  let loadReps = 0
  let warmupSets = 0
  const entries = model.entries.map(entry => ({
    id: entry.id,
    sets: entry.sets.map(slot => {
      const row = clone(slot.row)
      const completed = hasCompletedWork(row)
      const warmup = warmupFlag(row)
      if (completed) {
        completedSets += 1
        reps += repsOf(row)
        loadReps += loadRepsOf(row)
        if (warmup) warmupSets += 1
      }
      const draft = drafts && drafts[slot.setId] != null ? clone(drafts[slot.setId]) : null
      return { setId: slot.setId, completed, warmup, draft, row }
    }),
  }))

  return {
    status: finished ? 'finished' : 'active',
    timeZone,
    startedAt: Number.isFinite(model.start) ? model.start : null,
    elapsedMs: elapsedMs(stamps, clockEnd, DURATION_GAP_MS),
    overnight,
    disposition: finished
      ? { kind: 'finished', actions: [], suggestedEnd: null }
      : {
        kind: overnight ? 'overnight' : 'active',
        actions: overnight ? ['resume', 'finish', 'discard'] : [],
        suggestedEnd: Number.isFinite(suggested) ? suggested : null,
      },
    rest: finished ? null : projectRest(model.rest, now),
    entries,
    totals: { completedSets, reps, loadReps, warmupSets },
    finished,
  }
}

export function slotExists(model, exerciseId, setId) {
  return !!findSlot(model, exerciseId, setId)
}

export function entryExists(model, exerciseId) {
  return !!findEntry(model, exerciseId)
}
