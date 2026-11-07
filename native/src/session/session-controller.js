import { openSession } from './session.js'

// Screen-facing session commands. The React hook calls open() on mount and call() for each
// action. Storage failures stay on the returned result ({ ok: false, saved: false }) and on
// state.error. The in-memory session is unchanged when append throws, so the view still shows
// the set as unsaved.

const INITIAL = { status: 'loading', error: null, view: null }

export function createSessionController({ base, storage, now, timeZone } = {}) {
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
        session = await openSession({ base, storage, now, timeZone })
        state = { status: 'ready', error: null, view: session.view() }
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
