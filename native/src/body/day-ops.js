// Pure day rules for weigh-ins. A weigh-in operation is one day's change: set the day's
// weight, or remove the day. applyDayOps lays a phone's pending operations over the
// server's bodyweight list under per-day guards, so a Health op only replaces or removes the
// entry the import saw and a typed removal only removes the entry the phone saw. No I/O.

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

function reflected(op, entry) {
  if (op.op === 'remove') return !entry
  if (!entry) return false
  return entry.w === op.w && entry.t === op.t && (entry.src ?? null) === (op.src ?? null) && (entry.hk ?? null) === (op.hk ?? null)
}

// A Health op names the entry it replaces or removes: baseT is the t of the server copy's entry
// the import saw, whatever its source. An entry changed since (a web edit keeps src and hk) is kept.
function names(op, entry) {
  return op.baseT != null && Number(entry.t) === op.baseT
}

// removed: the stamp the document records for the day's removal (deleted.bodyweight[d]), or 0.
function canApply(op, entry, removed) {
  const health = isHealth(op)
  if (op.op === 'set') {
    // A removal on record beats a set made before it (the web's merge rule); a day with an
    // entry is decided by the entry guards below.
    if (!entry) return !(removed > 0 && removed >= op.t)
    if (health) return names(op, entry)
    // Between typed entries the later edit wins (as the web's merge does); equal t applies.
    return isHealth(entry) || !(Number(entry.t) > op.t)
  }
  if (!entry) return true
  if (health) return names(op, entry)
  return op.baseT != null && entry.t === op.baseT
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
  const gone = deleted && typeof deleted === 'object' && !Array.isArray(deleted) ? deleted : {}
  const byDay = new Map()
  for (const entry of Array.isArray(bodyweight) ? bodyweight : []) {
    if (!entry || typeof entry !== 'object' || entry.d == null) continue
    const kept = byDay.get(entry.d)
    if (!kept || (Number(entry.t) || 0) > (Number(kept.t) || 0)) byDay.set(entry.d, entry)
  }
  const applied = []
  const done = []
  const superseded = []
  for (const op of Array.isArray(ops) ? ops : []) {
    const entry = byDay.get(op.d)
    const ref = { d: op.d, t: op.t }
    if (reflected(op, entry)) done.push(ref)
    else if (!canApply(op, entry, Number(gone[op.d]) || 0)) superseded.push(ref)
    else {
      if (op.op === 'remove') byDay.delete(op.d)
      else byDay.set(op.d, entryFromOp(op))
      applied.push(ref)
    }
  }
  const next = [...byDay.values()].sort((a, b) => {
    const x = String(a.d)
    const y = String(b.d)
    return x < y ? -1 : x > y ? 1 : 0
  })
  return { next, applied, done, superseded }
}
