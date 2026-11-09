import { applyDayOps } from './day-ops'

// The whole effective weigh-in list, sorted by day: the server copy's list with this phone's pending
// ops laid over it. Unpaired (copy null), the snapshot's list stands in for the copy's.
export function effectiveBodyweight({ copy, snapshot, pending, deleted }) {
  const base = copy ? copy.state?.bodyweight : snapshot
  return applyDayOps(base ?? [], pending ?? [], deleted ?? copy?.state?.deleted?.bodyweight ?? {}).next
}
