// What the Nutrition screen and Home show, from one read of the stores: the Progress loader's state
// (pending edits laid over), the copy as read and the weigh-ins, plus the notices of nutrition edits
// that were not sent. Pure apart from the injected stores.
import { progressLoader } from '../progress/progress-source.js'
import { keyed, readSourceKey } from '../sync/source-key.js'

// The notices the Nutrition screen shows: a day's and a setting's, never a routine's.
async function readNotices(edits) {
  return [...await edits.listNotices({ kind: 'nutritionDay' }), ...await edits.listNotices({ kind: 'setting' })]
}

/**
 * One loader per screen. Each call reads the stores as they are then and resolves { ok: true,
 * source } (source { status: 'ready', state, copy, bodyweight, notices, error: null }) or { ok:
 * false, error: { message } }; it never throws. The state is keyed (sync/source-key.js), so an
 * unchanged one is not built again; the notices are read on every call (a Dismiss changes no
 * pending row).
 */
export function nutritionLoader() {
  const loadProgress = progressLoader()
  const load = keyed(readSourceKey, stores => loadProgress(stores))
  return async stores => {
    try {
      const notices = await readNotices(stores.edits)
      return { ok: true, source: { status: 'ready', ...await load(stores), notices, error: null } }
    } catch (error) {
      return { ok: false, error: { message: error?.message || String(error) } }
    }
  }
}
