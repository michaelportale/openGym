import { openRecovered } from './recovery.js'
import { toWorkoutPayload } from './finish.js'

// Screen-facing session commands. The React hook calls open() on mount and call() for each
// action. Storage failures stay on the returned result ({ ok: false, saved: false }) and on
// state.error. The in-memory session is unchanged when append throws, so the view still shows
// the set as unsaved.

const INITIAL = { status: 'loading', error: null, view: null }

function confirmedSave(result) {
  if (result === true) return true
  if (!result || typeof result !== 'object') return false
  if (result.saved === false || result.ok === false) return false
  return result.saved === true || result.ok === true
}

export function createSessionController({ base, storage, finishedWorkouts, now, timeZone } = {}) {
  let session = null
  let state = { ...INITIAL }

  function snapshot() {
    return {
      status: state.status,
      error: state.error ? { ...state.error } : null,
      view: state.view,
    }
  }

  return {
    getState: snapshot,

    async open() {
      try {
        const recovered = await openRecovered({ base, storage, finishedWorkouts, now, timeZone })
        session = recovered.session
        state = recovered.status === 'saved'
          ? { status: 'saved', error: null, view: null }
          : { status: 'ready', error: null, view: session.view() }
      } catch (error) {
        session = null
        state = {
          status: 'error',
          error: { code: 'storage', message: error?.message || 'open failed' },
          view: null,
        }
      }
      return snapshot()
    },

    // Builds the workout the API already stores and hands it to the injected sender.
    // The journal stays until that sender confirms the save. A second call after a
    // confirmed save does not send again: the workout is already keyed by the session id.
    async finishSession({ sender, end, eventId, workouts } = {}) {
      if (!session) {
        if (state.status === 'saved') return { ok: true, saved: true, duplicate: true }
        return {
          ok: false,
          saved: false,
          error: state.error || { code: 'not-ready', message: 'session is not open' },
        }
      }
      if (typeof sender !== 'function') {
        return { ok: false, saved: false, error: { code: 'sender', message: 'sender is required' } }
      }

      const current = session.view()
      if (current.status !== 'finished') {
        let sealed
        try {
          sealed = await session.finish({ eventId, end })
        } catch (error) {
          const failure = { code: 'storage', message: error?.message || 'finish failed' }
          state = { status: 'ready', error: failure, view: session.view() }
          return { ok: false, saved: false, error: failure }
        }
        if (!sealed.ok) {
          state = { status: 'ready', error: sealed.error || null, view: session.view() }
          return { ...sealed, saved: false }
        }
      }

      const finished = session.view().finished
      let payload
      try {
        payload = toWorkoutPayload(finished, { workouts })
      } catch (error) {
        const failure = { code: 'payload', message: error?.message || 'payload failed' }
        state = { status: 'ready', error: failure, view: session.view() }
        return { ok: false, saved: false, error: failure }
      }

      let confirmation
      try {
        confirmation = await sender(payload)
      } catch (error) {
        const failure = { code: 'send', message: error?.message || 'send failed' }
        state = { status: 'ready', error: failure, view: session.view() }
        return { ok: false, saved: false, error: failure, payload }
      }
      if (!confirmedSave(confirmation)) {
        const failure = { code: 'not-saved', message: 'sender did not confirm the save' }
        state = { status: 'ready', error: failure, view: session.view() }
        return { ok: false, saved: false, error: failure, payload }
      }

      // The local row is the folded workout. Write it before clearing the journal so a
      // failed clear can be retried, and the retry replaces the same id. A refused save
      // never reaches this write.
      if (finishedWorkouts) {
        try {
          await finishedWorkouts.put(payload.workout)
        } catch (error) {
          const failure = { code: 'storage', message: error?.message || 'finished workout was not stored' }
          state = { status: 'ready', error: failure, view: session.view() }
          return { ok: false, saved: true, error: failure, payload }
        }
      }

      try {
        await storage.clear()
      } catch (error) {
        const failure = { code: 'storage', message: error?.message || 'clear failed' }
        state = { status: 'ready', error: failure, view: session.view() }
        return { ok: false, saved: true, error: failure, payload }
      }
      session = null
      state = { status: 'saved', error: null, view: null }
      return { ok: true, saved: true, payload }
    },

    async call(name, ...args) {
      if (!session || typeof session[name] !== 'function') {
        return {
          ok: false,
          saved: false,
          error: state.error || { code: 'not-ready', message: 'session is not open' },
        }
      }
      const result = await session[name](...args)
      const view = session.view()
      state = {
        status: view.status === 'discarded' ? 'discarded' : 'ready',
        view,
        error: result && result.ok === false ? (result.error || { code: 'failed', message: 'request failed' }) : null,
      }
      return result
    },
  }
}
