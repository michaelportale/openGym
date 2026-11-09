// Pure day rules for weigh-ins. A weigh-in operation is one day's change: set the day's
// weight, or remove the day. applyDayOps lays a phone's pending operations over the
// server's bodyweight list under per-day guards, so a Health op only replaces or removes the
// entry the import saw and a typed removal only removes the entry the phone saw. The typed
// path (typedCanApply) and the day loop (runDayOps) are shared with body measurements
// (measurement-ops.js). No I/O.

export function roundLb(x) {
  const n = typeof x === 'string' && x.trim() !== '' ? Number(x) : x
  return typeof n === 'number' ? Math.round(n * 10) / 10 : NaN
}

function isHealth(value) {
  return value?.src === 'health'
}

// The entry an op writes: { d, w, t }, plus src and hk only when present.
export function entryFromOp(op) {
  const entry = { d: op.d, w: op.w, t: op.t }
  if (op.src != null) entry.src = op.src
  if (op.hk != null) entry.hk = op.hk
  return entry
}

// Whether a day's entry already is what a set writes.
function holds(op, entry) {
  return entry.w === op.w && entry.t === op.t && (entry.src ?? null) === (op.src ?? null) && (entry.hk ?? null) === (op.hk ?? null)
}

// A Health op names the entry it replaces or removes: baseT is the t of the server copy's entry
// the import saw, whatever its source. An entry changed since (a web edit keeps src and hk) is kept.
function names(op, entry) {
  return op.baseT != null && Number(entry.t) === op.baseT
}

// The typed path, shared with body measurements (measurement-ops.js). removed: the stamp the
// document records for the day's removal (deleted.<list>[d]), or 0.
export function typedCanApply(op, entry, removed) {
  if (op.op === 'set') {
    // A removal on record beats a set made before it (the web's merge rule); a day with an
    // entry is decided by the entry.
    if (!entry) return !(removed > 0 && removed >= op.t)
    // The later edit wins (as the web's merge does); equal t applies.
    return !(Number(entry.t) > op.t)
  }
  // A remove takes out only the entry the phone saw; a day with none has nothing to take out.
  if (!entry) return true
  return op.baseT != null && entry.t === op.baseT
}

// A weigh-in adds the Health path: a Health op touches only the entry it names, and a typed set
// replaces any Health entry. Everything else is the typed path.
function canApply(op, entry, removed) {
  if (entry && isHealth(op)) return names(op, entry)
  if (entry && op.op === 'set' && isHealth(entry)) return true
  return typedCanApply(op, entry, removed)
}

// Days sort by String(d), so a list holding a d of another type still sorts one way.
export function compareDays(a, b) {
  const x = String(a.d)
  const y = String(b.d)
  return x < y ? -1 : x > y ? 1 : 0
}

// The day loop, shared with body measurements. `list` is indexed by day: if two entries share a
// day the one with the larger t is the day's, the first on equal t, as the web does; an element
// that is not an object or has no d is on no day. Each op then meets its day's entry: done when
// the day already shows it (a remove: no entry; a set: holds(op, entry)), applied when
// canApply(op, entry, removed) allows it, superseded otherwise. An applied set makes entryOf(op)
// the day's entry, an applied remove empties the day. Returns { days (day -> entry after the ops),
// applied, done, superseded }; the last three list { d, t } of the ops. deleted: the document's
// removal records for the list (day -> stamp, positive while removed); anything but a map counts
// as empty. Inputs are never mutated.
export function runDayOps(list, ops, deleted, { holds, canApply, entryOf }) {
  const gone = deleted && typeof deleted === 'object' && !Array.isArray(deleted) ? deleted : {}
  const days = new Map()
  for (const entry of Array.isArray(list) ? list : []) {
    if (!entry || typeof entry !== 'object' || entry.d == null) continue
    const kept = days.get(entry.d)
    if (!kept || (Number(entry.t) || 0) > (Number(kept.t) || 0)) days.set(entry.d, entry)
  }
  const applied = []
  const done = []
  const superseded = []
  for (const op of Array.isArray(ops) ? ops : []) {
    const entry = days.get(op.d)
    const ref = { d: op.d, t: op.t }
    if (op.op === 'remove' ? !entry : !!entry && holds(op, entry)) done.push(ref)
    else if (!canApply(op, entry, Number(gone[op.d]) || 0)) superseded.push(ref)
    else {
      if (op.op === 'remove') days.delete(op.d)
      else days.set(op.d, entryOf(op))
      applied.push(ref)
    }
  }
  return { days, applied, done, superseded }
}

// bodyweight: the list to start from (undefined, not an array, or holding non-objects is
// tolerated: a non-array counts as empty, and elements that are not objects or have no d
// cannot be placed on a day, so they are left out of next; this matches sync-merge.js). If
// two entries share a day the one with the larger t is kept, the first on equal t, as the
// web does. Every other entry is passed through as the same
// object, so fields this code does not know survive. Inputs are never mutated.
// Returns { next, applied, done, superseded }; each of the last three lists { d, t } of the ops.
// deleted: the document's `deleted.bodyweight` (day -> stamp, positive while removed); anything
// but a map counts as empty.
export function applyDayOps(bodyweight, ops, deleted) {
  const { days, applied, done, superseded } = runDayOps(bodyweight, ops, deleted, { holds, canApply, entryOf: entryFromOp })
  return { next: [...days.values()].sort(compareDays), applied, done, superseded }
}
