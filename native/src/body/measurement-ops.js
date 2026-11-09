// Pure day rules for body measurements: the weigh-in typed path (day-ops.js typedCanApply and
// runDayOps), with the whole entry as an op's content. A measurement op is one day's change: set
// the day's entry ({ d, op: 'set', entry, t }, the entry carrying the same d and t), or remove the
// day ({ d, op: 'remove', t, baseT }, baseT the t of the entry the removal takes out). There is no
// Health path and no rounding: values are the entry's own cm. No I/O.
import { compareDays, runDayOps, typedCanApply } from './day-ops.js'

const isObj = v => !!v && typeof v === 'object'

// Whether two JSON values are the same, whatever the order of an object's keys (an entry comes
// back from the server as it was sent, but nothing here depends on its key order).
export function sameValue(a, b) {
  if (a === b) return true
  if (!isObj(a) || !isObj(b) || Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a)) return a.length === b.length && a.every((x, i) => sameValue(x, b[i]))
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every(k => Object.prototype.hasOwnProperty.call(b, k) && sameValue(a[k], b[k]))
}

const MEASUREMENTS = {
  holds: (op, entry) => sameValue(entry, op.entry),
  canApply: typedCanApply,
  entryOf: op => op.entry,
}

// The phone's pending ops laid over the document's `measurements` list under the typed guard:
// a set applies unless the day holds a later entry, or (a day with no entry) a removal on record
// at or after it; a remove applies only to the entry it names (entry.t === baseT); a set is done
// when the day holds an equal entry, a remove when the day has none. If two entries share a day,
// the one with the larger t (the first on equal t) is the one the guard reads.
//
// next: every row of a day no op applied to passes through as the same object, two rows of one
// day included (the web folds them; dropping one would lose its values), so a push leaves other
// days byte-identical. A day an op applied to holds the op's entry, or nothing after a remove.
// Elements that are not objects or have no d are on no day and are left out, as the web's merge
// leaves them. Sorted by day; inputs are never mutated. deleted: the document's
// `deleted.measurements`. Returns { next, applied, done, superseded }, each of the last three a
// list of { d, t } of the ops.
export function applyMeasurementOps(measurements, ops, deleted) {
  const { days, applied, done, superseded } = runDayOps(measurements, ops, deleted, MEASUREMENTS)
  const moved = new Set(applied.map(r => r.d))
  const kept = (Array.isArray(measurements) ? measurements : []).filter(e => isObj(e) && e.d != null && !moved.has(e.d))
  const placed = [...moved].filter(d => days.has(d)).map(d => days.get(d))
  return { next: [...kept, ...placed].sort(compareDays), applied, done, superseded }
}
