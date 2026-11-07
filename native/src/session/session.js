import { finishWorkout } from '../shared/training.js'
import { activityAt, elapsedStamps, entryExists, exerciseSetIds, extendBy, foldJournal, projectSession, slotExists, toActive, workoutFold } from './fold.js'
import { DURATION_GAP_MS, compactSeen, isOvernight, shownThrough } from './timing.js'
import { createEventId } from './ids.js'

const { sessionEnd } = finishWorkout

export { plannedSetId } from './ids.js'

// A live timer reads view() often. The base is rewritten only after the counted
// instant has moved this far, unless the caller flushes.
export const SEEN_PERSIST_MS = 15 * 1000

function failure(code, message) {
  return { ok: false, saved: false, error: { code, message: message || code } }
}

function duplicate() {
  return { ok: true, saved: false, duplicate: true }
}

function unchanged() {
  return { ok: true, saved: false, unchanged: true }
}

export async function openSession({ base, storage, now, timeZone = 'UTC' } = {}) {
  if (!storage) throw new Error('openSession requires a storage')
  const storedBase = await storage.readBase()
  const events = await storage.readAll()
  const drafts = await storage.readDrafts()
  let resolved = storedBase
  // Overnight is a local date in the zone the session started in. A later boot often
  // passes UTC, which can put last night and this morning on the same calendar day.
  // The zone is written with the base and reused. A journal from before this was
  // stored takes the zone of the boot that first finds it.
  const callerZone = typeof timeZone === 'string' && timeZone ? timeZone : 'UTC'
  let zone = typeof storage.readTimeZone === 'function' ? await storage.readTimeZone() : ''
  if (typeof zone !== 'string' || !zone) zone = ''
  const seenAt = typeof storage.readLastSeen === 'function' ? await storage.readLastSeen() : null
  const seenTrail = typeof storage.readSeenTrail === 'function' ? await storage.readSeenTrail() : null
  if (!resolved && base) {
    await storage.writeBase(base, { timeZone: callerZone })
    resolved = await storage.readBase()
    zone = callerZone
  } else if (resolved && !zone) {
    await storage.writeBase(resolved, { timeZone: callerZone })
    zone = callerZone
  }
  return new SessionLog({
    base: resolved,
    events,
    drafts,
    storage,
    now: typeof now === 'function' ? now : Date.now,
    timeZone: zone || callerZone,
    seenAt,
    seenTrail,
  })
}

class SessionLog {
  #seenChain = Promise.resolve()
  #queuedSeen = null

  constructor({ base, events, drafts, storage, now, timeZone, seenAt, seenTrail }) {
    this.base = base
    this.events = events || []
    this.drafts = drafts || {}
    this.storage = storage
    this.now = now
    this.timeZone = timeZone
    this.discarded = false
    // Counted instants from a previous process. The last one alone is not enough:
    // the hop from the last set to that instant can be an idle overnight gap even
    // when the steps in between were counted.
    const trail = Array.isArray(seenTrail) ? seenTrail.filter(at => Number.isFinite(at)) : []
    this.samples = trail.length ? trail.slice() : (Number.isFinite(seenAt) ? [seenAt] : [])
    const queued = Number.isFinite(seenAt) ? seenAt : this.samples[this.samples.length - 1]
    if (Number.isFinite(queued)) this.#queuedSeen = queued
  }

  view({ timeZone = this.timeZone } = {}) {
    const now = this.now()
    this.#sample(now)
    if (this.discarded) {
      return projectSession(foldJournal(null, []), { now, timeZone, drafts: {}, discarded: true, samples: this.samples })
    }
    const model = foldJournal(this.base, this.events)
    return projectSession(model, { now, timeZone, drafts: this.drafts, discarded: false, samples: this.samples })
  }

  // Records the instant the timer has counted. Skips the write when that instant is
  // still within SEEN_PERSIST_MS of the last one stored.
  async noteSeen() {
    this.#persistSeen(this.#shownNow(), false)
    await this.#seenChain
  }

  // Background, finish, and discard. Writes the current instant even inside the throttle.
  async flushSeen() {
    this.#persistSeen(this.#shownNow(), true)
    await this.#seenChain
  }

  #shownNow() {
    const now = this.now()
    this.#sample(now)
    if (this.discarded) return null
    const model = foldJournal(this.base, this.events)
    const clockEnd = model.finished ? model.finished.end : now
    return shownThrough(elapsedStamps(model, this.samples), clockEnd, DURATION_GAP_MS, this.timeZone)
  }

  #persistSeen(at, force) {
    if (!Number.isFinite(at)) return
    if (this.#queuedSeen != null && at <= this.#queuedSeen) return
    if (!force && this.#queuedSeen != null && at - this.#queuedSeen < SEEN_PERSIST_MS) return
    if (typeof this.storage.putLastSeen !== 'function') return
    this.#queuedSeen = at
    const trail = compactSeen(this.samples, this.timeZone)
    this.#seenChain = this.#seenChain
      .catch(() => {})
      .then(() => this.storage.putLastSeen(at, trail.length ? trail : [at]))
      .catch(() => {
        if (this.#queuedSeen === at) this.#queuedSeen = null
      })
  }

  #sample(now) {
    if (!Number.isFinite(now)) return
    if (this.samples[this.samples.length - 1] === now) return
    this.samples.push(now)
  }

  getDraft(setId) {
    const value = this.drafts[setId]
    return value == null ? null : JSON.parse(JSON.stringify(value))
  }

  async putDraft(setId, fields) {
    if (this.discarded) return failure('discarded')
    if (this.#isFinished()) return failure('finished')
    try {
      await this.storage.putDraft(setId, fields)
    } catch (error) {
      return failure('storage', error?.message || 'draft failed')
    }
    if (fields == null) delete this.drafts[setId]
    else this.drafts[setId] = JSON.parse(JSON.stringify(fields))
    return { ok: true, saved: true }
  }

  async commitSet({ eventId, exerciseId, setId, fields } = {}) {
    if (this.#seen(eventId)) return duplicate()
    const model = this.#model()
    if (!this.discarded && !this.#isFinished() && !slotExists(model, exerciseId, setId)) return failure('unknown-set')
    const merged = { ...(this.drafts[setId] || {}) }
    for (const [key, value] of Object.entries(fields || {})) merged[key] = value
    const result = await this.#append({
      id: eventId,
      type: 'set.commit',
      at: this.now(),
      exerciseId,
      setId,
      fields: merged,
    })
    if (result.saved) {
      try {
        await this.storage.putDraft(setId, null)
      } catch (error) {
        return { ok: true, saved: true, draftError: { code: 'storage', message: error?.message || 'draft clear failed' } }
      }
      delete this.drafts[setId]
    }
    return result
  }

  async editSet({ eventId, exerciseId, setId, fields } = {}) {
    if (this.#seen(eventId)) return duplicate()
    const model = this.#model()
    if (!this.discarded && !this.#isFinished() && !slotExists(model, exerciseId, setId)) return failure('unknown-set')
    return this.#append({
      id: eventId,
      type: 'set.edit',
      at: this.now(),
      exerciseId,
      setId,
      fields: fields || {},
    })
  }

  async undoSet({ eventId, exerciseId, setId } = {}) {
    if (this.#seen(eventId)) return duplicate()
    const model = this.#model()
    if (!this.discarded && !this.#isFinished() && !slotExists(model, exerciseId, setId)) return failure('unknown-set')
    return this.#append({
      id: eventId,
      type: 'set.undo',
      at: this.now(),
      exerciseId,
      setId,
    })
  }

  // A live exercise keeps at least one set. Undo clears the tick; remove drops the row.
  async removeSet({ eventId, exerciseId, setId } = {}) {
    if (this.#seen(eventId)) return duplicate()
    if (!this.discarded && !this.#isFinished()) {
      const model = this.#model()
      if (!slotExists(model, exerciseId, setId)) return failure('unknown-set')
      const entry = model.entries.find(item => item.id === exerciseId)
      if (!entry || entry.sets.length <= 1) return failure('last-set')
    }
    const result = await this.#append({
      id: eventId,
      type: 'set.remove',
      at: this.now(),
      exerciseId,
      setId,
    })
    if (result.saved) {
      try {
        await this.storage.putDraft(setId, null)
      } catch (error) {
        return { ok: true, saved: true, draftError: { code: 'storage', message: error?.message || 'draft clear failed' } }
      }
      delete this.drafts[setId]
    }
    return result
  }

  async addSet({ eventId, exerciseId, setId, fields } = {}) {
    if (this.#seen(eventId)) return duplicate()
    const model = this.#model()
    if (!this.discarded && !this.#isFinished()) {
      if (!entryExists(model, exerciseId)) return failure('unknown-exercise')
      // A missing id, or one already on any exercise, would append a row the fold drops.
      // Replay would then disagree with the saved: true the caller already saw.
      if (typeof setId !== 'string' || setId === '') return failure('unknown-set')
      const taken = model.entries.some(entry => entry.sets.some(slot => slot.setId === setId))
      if (taken) return failure('known-set')
    }
    return this.#append({
      id: eventId,
      type: 'set.add',
      at: this.now(),
      exerciseId,
      setId,
      fields: fields || {},
    })
  }

  async addExercise({ eventId, exerciseId, entry } = {}) {
    if (this.#seen(eventId)) return duplicate()
    if (!this.discarded && !this.#isFinished()) {
      if (typeof exerciseId !== 'string' || exerciseId === '') return failure('unknown-exercise')
      const model = this.#model()
      if (entryExists(model, exerciseId)) return failure('known-exercise')
      // Same ids the fold would store. A repeat, or one already on the session,
      // would append an exercise whose sets cannot be told apart.
      const setIds = exerciseSetIds(exerciseId, entry)
      const taken = new Set()
      for (const item of model.entries) {
        for (const slot of item.sets) taken.add(slot.setId)
      }
      const seen = new Set()
      for (const setId of setIds) {
        if (seen.has(setId) || taken.has(setId)) return failure('known-set')
        seen.add(setId)
      }
    }
    return this.#append({
      id: eventId,
      type: 'exercise.add',
      at: this.now(),
      exerciseId,
      entry: entry && typeof entry === 'object' ? entry : {},
    })
  }

  // A live session keeps at least one exercise, same as a live exercise keeps one set.
  // Finishing with no completed sets stays allowed: that is a skipped workout, not an
  // empty plan. Discard is how the session goes away.
  async removeExercise({ eventId, exerciseId } = {}) {
    if (this.#seen(eventId)) return duplicate()
    let setIds = []
    if (!this.discarded && !this.#isFinished()) {
      const model = this.#model()
      const entry = model.entries.find(item => item.id === exerciseId)
      if (!entry) return failure('unknown-exercise')
      if (model.entries.length <= 1) return failure('last-exercise')
      setIds = entry.sets.map(slot => slot.setId)
    }
    const result = await this.#append({
      id: eventId,
      type: 'exercise.remove',
      at: this.now(),
      exerciseId,
    })
    if (result.saved) {
      for (const setId of setIds) {
        try {
          await this.storage.putDraft(setId, null)
        } catch (error) {
          return { ok: true, saved: true, draftError: { code: 'storage', message: error?.message || 'draft clear failed' } }
        }
        delete this.drafts[setId]
      }
    }
    return result
  }

  async moveExercise({ eventId, exerciseId, toIndex } = {}) {
    if (this.#seen(eventId)) return duplicate()
    // The fold ignores a non-integer index, so the event would say the exercise moved.
    if (!Number.isInteger(toIndex)) return failure('bad-index')
    const model = this.#model()
    if (!this.discarded && !this.#isFinished() && !entryExists(model, exerciseId)) return failure('unknown-exercise')
    return this.#append({
      id: eventId,
      type: 'exercise.move',
      at: this.now(),
      exerciseId,
      toIndex,
    })
  }

  async startRest({ eventId, deadline, durationMs, totalMs } = {}) {
    if (this.#seen(eventId)) return duplicate()
    const at = this.now()
    const resolved = Number.isFinite(deadline) ? deadline : at + Number(durationMs)
    if (!Number.isFinite(resolved)) return failure('bad-deadline')
    const span = Math.max(0, resolved - at)
    return this.#append({
      id: eventId,
      type: 'rest.start',
      at,
      deadline: resolved,
      totalMs: Number.isFinite(totalMs) ? totalMs : span,
    })
  }

  async pauseRest({ eventId } = {}) {
    if (this.#seen(eventId)) return duplicate()
    const rest = this.view().rest
    if (!this.discarded && !this.#isFinished() && (!rest || rest.status !== 'running')) return failure('no-rest')
    return this.#append({ id: eventId, type: 'rest.pause', at: this.now() })
  }

  async extendRest({ eventId, byMs } = {}) {
    if (this.#seen(eventId)) return duplicate()
    if (!Number.isFinite(byMs) || byMs === 0) return failure('bad-extend')
    const rest = this.view().rest
    if (!this.discarded && !this.#isFinished()) {
      if (!rest) return failure('no-rest')
      // A full rest grows by nothing. The fold would keep the event and ignore it.
      if (extendBy(rest, byMs) === 0) return failure('bad-extend')
    }
    return this.#append({ id: eventId, type: 'rest.extend', at: this.now(), byMs })
  }

  async cancelRest({ eventId } = {}) {
    if (this.#seen(eventId)) return duplicate()
    const rest = this.view().rest
    if (!this.discarded && !this.#isFinished() && !rest) return failure('no-rest')
    return this.#append({ id: eventId, type: 'rest.cancel', at: this.now() })
  }

  async setNote({ eventId, note } = {}) {
    if (this.#seen(eventId)) return duplicate()
    if (!this.discarded && !this.#isFinished()) {
      if (typeof note !== 'string') return failure('bad-note')
      if (note.length > 2000) return failure('note-too-long')
    }
    return this.#append({
      id: eventId,
      type: 'session.note',
      at: this.now(),
      note: typeof note === 'string' ? note : '',
    })
  }

  async setExerciseNote({ eventId, exerciseId, note, notePin } = {}) {
    if (this.#seen(eventId)) return duplicate()
    if (!this.discarded && !this.#isFinished()) {
      if (typeof note !== 'string') return failure('bad-note')
      if (note.length > 2000) return failure('note-too-long')
      if (!entryExists(this.#model(), exerciseId)) return failure('unknown-exercise')
      if (notePin != null && typeof notePin !== 'boolean') return failure('bad-note')
    }
    const event = {
      id: eventId,
      type: 'exercise.note',
      at: this.now(),
      exerciseId,
      note: typeof note === 'string' ? note : '',
    }
    if (typeof notePin === 'boolean') event.notePin = notePin
    return this.#append(event)
  }

  async resume({ eventId } = {}) {
    if (this.#seen(eventId)) return duplicate()
    if (this.discarded) return failure('discarded')
    if (this.#isFinished()) return failure('finished')
    if (!this.view().overnight) return failure('not-overnight')
    return this.#append({ id: eventId, type: 'session.resume', at: this.now() })
  }

  async finish({ eventId, end } = {}) {
    if (this.discarded) return failure('discarded')
    if (this.#seen(eventId)) return duplicate()
    if (this.#isFinished()) return failure('finished')
    const now = this.now()
    const model = this.#model()
    const active = toActive(model)
    const overnight = isOvernight(activityAt(model), now, this.timeZone)
    let chosen = end
    if (chosen == null) {
      if (overnight) return failure('overnight')
      chosen = sessionEnd(active, now)
    }
    if (!Number.isFinite(chosen)) return failure('bad-end')
    if (Number.isFinite(active.start) && chosen < active.start) return failure('end-before-start')
    return this.#append({ id: eventId, type: 'session.finish', at: now, end: chosen })
  }

  async discard() {
    if (this.discarded) return duplicate()
    if (this.#isFinished()) return failure('finished')
    try {
      await this.flushSeen()
      await this.storage.clear()
    } catch (error) {
      return failure('storage', error?.message || 'clear failed')
    }
    this.events = []
    this.drafts = {}
    this.base = null
    this.discarded = true
    return { ok: true, saved: true }
  }

  #model() {
    return foldJournal(this.base, this.events)
  }

  #seen(eventId) {
    return eventId != null && this.events.some(event => event.id === eventId)
  }

  #isFinished() {
    return this.events.some(event => event.type === 'session.finish')
  }

  async #append(event) {
    if (this.discarded) return failure('discarded')
    const id = event.id != null ? event.id : createEventId()
    if (this.#seen(id)) return duplicate()
    if (this.#isFinished()) return failure('finished')
    // The journal is JSON. NaN becomes null and undefined keys disappear on write.
    // Fold that same document now, so a restart cannot show a different row.
    let stored
    try {
      stored = JSON.parse(JSON.stringify({ ...event, id }))
    } catch (error) {
      return failure('storage', error?.message || 'append failed')
    }
    // A saved event has to change the workout a reopen folds. resume is the
    // exception: it only leaves a stamp so the timer can cross midnight.
    if (stored.type !== 'session.resume') {
      const before = workoutFold(this.base, this.events)
      const after = workoutFold(this.base, this.events.concat([stored]))
      if (before === after) return unchanged()
    }
    try {
      const result = await this.storage.append(stored)
      if (result?.duplicate) return duplicate()
    } catch (error) {
      return failure('storage', error?.message || 'append failed')
    }
    this.events.push(stored)
    return { ok: true, saved: true }
  }
}
