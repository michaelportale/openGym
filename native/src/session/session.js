import { finishWorkout } from '../shared/training.js'
import { activityAt, entryExists, foldJournal, projectSession, slotExists, toActive } from './fold.js'
import { isOvernight } from './timing.js'
import { createEventId } from './ids.js'

const { sessionEnd } = finishWorkout

export { plannedSetId } from './ids.js'

function failure(code, message) {
  return { ok: false, saved: false, error: { code, message: message || code } }
}

function duplicate() {
  return { ok: true, saved: false, duplicate: true }
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
  })
}

class SessionLog {
  constructor({ base, events, drafts, storage, now, timeZone }) {
    this.base = base
    this.events = events || []
    this.drafts = drafts || {}
    this.storage = storage
    this.now = now
    this.timeZone = timeZone
    this.discarded = false
    // now() values already shown in this process. Elapsed keeps them so a later clock step
    // cannot erase time the live view already reported. Not written to storage.
    this.samples = []
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
    const model = this.#model()
    if (!this.discarded && !this.#isFinished() && !entryExists(model, exerciseId)) return failure('unknown-exercise')
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
      if (entryExists(this.#model(), exerciseId)) return failure('known-exercise')
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
    const rest = this.view().rest
    if (!this.discarded && !this.#isFinished() && !rest) return failure('no-rest')
    if (!Number.isFinite(byMs) || byMs === 0) return failure('bad-extend')
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
    if (this.discarded) return failure('discarded')
    if (this.#isFinished()) return failure('finished')
    if (this.#seen(eventId)) return duplicate()
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
    const stored = { ...event, id }
    if (this.#seen(id)) return duplicate()
    if (this.#isFinished()) return failure('finished')
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
