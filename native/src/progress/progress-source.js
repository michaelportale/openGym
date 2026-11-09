// The Progress tab's data from one read of the server copy: the Workout tab's screen source and
// the effective weigh-in list (the copy's, or the snapshot's when unpaired, with this phone's
// pending weigh-ins laid over it). Pure apart from the injected stores.
import { effectiveBodyweight } from '../body/effective-bodyweight.js'
import { readScreenSource } from '../sync/source.js'
import { keyed, readSourceKey } from '../sync/source-key.js'

// A weigh-in cannot change any lift, so `state` is keyed on everything but the weigh-ins: logging
// one keeps the same state object (and the lifts worked out from it). Make one per screen.
export function progressLoader() {
  const loadState = keyed(stores => readSourceKey({ ...stores, weighIns: null }), readScreenSource)
  return async stores => {
    // Pending rows before the copy: a sync stores the copy, then acks the rows.
    const pending = await stores.weighIns.listPending()
    const { state, copy } = await loadState(stores)
    return { state, bodyweight: effectiveBodyweight({ copy, snapshot: stores.bundled?.state?.bodyweight, pending }) }
  }
}
