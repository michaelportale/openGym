// The Progress tab's data from one read of the server copy: the Workout tab's screen source and
// the effective weigh-in list (the copy's, or the snapshot's when unpaired, with this phone's
// pending weigh-ins laid over it). Pure apart from the injected stores.
import { effectiveBodyweight } from '../body/effective-bodyweight.js'
import { readScreenSource } from '../sync/source.js'

export async function loadProgress({ finished, serverCopy, weighIns, bundled }) {
  // Pending rows before the copy: a sync stores the copy, then acks the rows.
  const pending = await weighIns.listPending()
  const { state, copy } = await readScreenSource({ finished, serverCopy, bundled })
  const bodyweight = effectiveBodyweight({ copy, snapshot: bundled?.state?.bodyweight, pending })
  return { state, bodyweight }
}
