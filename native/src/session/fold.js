import { finishWorkout, workoutModel } from '../shared/training.js'
import { DURATION_GAP_MS, REST_MAX_MS, clampMs, elapsedMs, isOvernight, projectRest, stampAt } from './timing.js'
import { plannedSetId } from './ids.js'
import { SESSION_LAST_SEEN_KEY, SESSION_SEEN_TRAIL_KEY, SESSION_TIME_ZONE_KEY } from './storage.js'

const { buildCompletedWorkout, sessionEnd } = finishWorkout
const { hasCompletedWork, isSideSet } = workoutModel

function clone(value) {
  // Plain JSON only. Hermes on device may not provide structuredClone.
  return value == null ? value : JSON.parse(JSON.stringify(value))
}

export function activityAt(model) {
  for (let i = model.stamps.length - 1; i >= 0; i -= 1) {
    const at = stampAt(model.stamps[i])
    if (at != null) return at
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

function rawCopiedSets(entry) {
  if (entry && typeof entry === 'object' && !Array.isArray(entry) && Array.isArray(entry.sets) && entry.sets.length) {
    return entry.sets
  }
  return [{}]
}

// The id the fold will store. A missing id becomes plan:<exercise>:<index>.
// A number is the same string the journal keeps, so "0" and 0 are one id.
export function exerciseSetIds(exerciseId, entry) {
  return rawCopiedSets(entry).map((set, index) => (
    set && typeof set === 'object' && set.id != null ? String(set.id) : plannedSetId(exerciseId, index)
  ))
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

// A per-side row is done only when both sides are. The fold applies this to the base
// and after every event, so a move or a copied exercise cannot leave a stale flag.
function syncSideDone(model) {
  for (const entry of model.entries) {
    for (const slot of entry.sets) {
      const row = slot.row
      if (!isSideSet(row)) continue
      row.done = row.sides.L?.done === true && row.sides.R?.done === true
    }
  }
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

export function extendBy(rest, byMs) {
  if (!rest || !Number.isFinite(byMs) || byMs === 0) return 0
  const room = Math.max(0, REST_MAX_MS - rest.totalMs)
  return byMs > 0 ? Math.min(byMs, room) : byMs
}

function applyExtend(model, event) {
  const applied = extendBy(model.rest, Number(event.byMs))
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
      const namedSides = event.fields != null && Object.prototype.hasOwnProperty.call(event.fields, 'sides')
      if (isSideSet(row) && !namedSides) {
        row.sides = {
          L: { ...row.sides.L, done: true },
          R: { ...row.sides.R, done: true },
        }
      } else if (!isSideSet(row)) {
        row.done = true
      }
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
      const row = clearDone(mergeFields({}, event.fields))
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
      const rawSets = rawCopiedSets(event.entry)
      delete src.sets
      const setIds = exerciseSetIds(id, event.entry)
      const sets = rawSets.map((set, index) => {
        const row = clearDone(set && typeof set === 'object' ? clone(set) : {})
        delete row.id
        return { setId: setIds[index], row }
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
    case 'exercise.note': {
      const entry = findEntry(model, event.exerciseId)
      if (!entry?.source || typeof event.note !== 'string') return
      if (!event.note.trim()) {
        delete entry.source.note
        delete entry.source.notePin
        return
      }
      entry.source.note = event.note
      if (event.notePin === true) entry.source.notePin = true
      else if (event.notePin === false) delete entry.source.notePin
      return
    }
    case 'session.note':
      if (typeof event.note !== 'string') return
      if (event.note.trim()) model.base.note = event.note
      else delete model.base.note
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
  syncSideDone(model)
  const seen = new Set()
  for (const event of events || []) {
    if (!event || event.id == null || seen.has(event.id)) continue
    seen.add(event.id)
    if (model.finished) continue
    applyEvent(model, event)
    syncSideDone(model)
    if (Number.isFinite(event.at)) {
      model.stamps.push(event.type === 'session.resume' ? { at: event.at, resume: true } : event.at)
    }
  }
  return model
}

export function toActive(model) {
  const base = clone(model.base || {})
  delete base[SESSION_TIME_ZONE_KEY]
  delete base[SESSION_LAST_SEEN_KEY]
  delete base[SESSION_SEEN_TRAIL_KEY]
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

// Samples are instants this timer has already counted. They are not journal events, so
// they do not move the activity anchor. The newest one that counted is also stored on the
// base; a restarted process seeds it back and does not rewind that time.
export function elapsedStamps(model, samples) {
  const finished = model?.finished
  const stamps = []
  if (Number.isFinite(model?.start)) stamps.push(model.start)
  for (const stamp of model?.stamps || []) {
    const at = stampAt(stamp)
    if (at == null) continue
    if (!finished || at <= finished.end) stamps.push(stamp)
  }
  for (const sample of samples || []) {
    if (!Number.isFinite(sample)) continue
    // A clock step backward of the device can be earlier than the session. Leaving
    // it out keeps that step from becoming the start of the timer.
    if (Number.isFinite(model?.start) && sample < model.start) continue
    if (!finished || sample <= finished.end) stamps.push({ at: sample, sample: true })
  }
  // Samples are not journal events, so they were listed after every event. A resume
  // logged later in the night would then sit in front of earlier samples and erase them.
  stamps.sort((a, b) => stampAt(a) - stampAt(b))
  return stamps
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
      note: '',
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
  const stamps = elapsedStamps(model, samples)

  let completedSets = 0
  let reps = 0
  let loadReps = 0
  let warmupSets = 0
  const entries = model.entries.map(entry => ({
    id: entry.id,
    note: typeof entry.source?.note === 'string' ? entry.source.note : '',
    notePin: entry.source?.notePin === true,
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
    elapsedMs: elapsedMs(stamps, clockEnd, DURATION_GAP_MS, timeZone),
    overnight,
    disposition: finished
      ? { kind: 'finished', actions: [], suggestedEnd: null }
      : {
        kind: overnight ? 'overnight' : 'active',
        actions: overnight ? ['resume', 'finish', 'discard'] : [],
        suggestedEnd: Number.isFinite(suggested) ? suggested : null,
      },
    rest: finished ? null : projectRest(model.rest, now),
    note: typeof model.base?.note === 'string' ? model.base.note : '',
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
