// What the API does to one routine the phone pushes, before it stamps it: PUT /api/data's step 0
// for a writer that does not stamp (`stamped: false`, as this phone is). Every key the stored
// routine has and the pushed one lacks is put back, unless an app that does not stamp may have
// dropped it on purpose; the same for each slot, paired with a stored slot as the API pairs them.
// Hand-copied from api/sync-stamps.js (keepKeys for `routines`, pairItems, V139_DROPS, the entry
// meta); server-put-back.test.js runs the real keepUnknown over generated edits to keep them the
// same. Pure; inputs are never mutated.

const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v)
const same = (x, y) => JSON.stringify(x) === JSON.stringify(y)
const clone = v => (v === undefined ? v : JSON.parse(JSON.stringify(v)))

// sync-stamps.js ENTRY_META and the two places of V139_DROPS a routine goes through.
const ENTRY_META = new Set(['id', '_ts', '_f', '_u'])
const V139_DROPS = {
  routines: new Set(['excludeFromProgression']),
  'routines.ex': new Set(['id', 'sg', 'sets', 'min', 'speed', 'mode', 'sec', 'weight', 'bodyweight', 'prog',
    'inc', 'deloadFactor', 'note', 'warmupSets', 'restSec', 'reps', 'side', 'repsMin', 'repsMax', 'intensifier']),
}
const NESTED = { routines: ['ex'] }

// sync-stamps.js keepKeys, for a routine and its slots. Mutates `x`.
function keepKeys(old, x, place) {
  if (!isMap(old) || !isMap(x)) return
  const drops = V139_DROPS[place] || new Set()
  for (const k of Object.keys(old)) {
    if (k in x || drops.has(k) || ENTRY_META.has(k)) continue
    x[k] = clone(old[k])
  }
  for (const f of NESTED[place] || []) {
    const a = old[f]
    const b = x[f]
    if (!Array.isArray(a) || !Array.isArray(b)) continue
    for (const [o, n] of pairItems(a, b)) keepKeys(o, n, `${place}.${f}`)
  }
}

// sync-stamps.js pairItems: which item of `a` each item of `b` is. By id when every id is there
// and once per list; with ids that repeat, along the longest run of ids both lists share in
// order; without ids, by position only when the lists match in length and ids.
function pairItems(a, b) {
  const ids = xs => xs.map(x => (isMap(x) ? x.id : undefined))
  const ia = ids(a)
  const ib = ids(b)
  const unique = xs => xs.every(k => k != null) && new Set(xs).size === xs.length
  if (unique(ia) && unique(ib)) {
    const by = new Map(a.map(x => [x.id, x]))
    return b.filter(x => by.has(x.id)).map(x => [by.get(x.id), x])
  }
  if (ia.every(k => k != null) && ib.every(k => k != null) && a.length * b.length <= 40000) {
    const L = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0))
    for (let i = a.length - 1; i >= 0; i--) {
      for (let j = b.length - 1; j >= 0; j--) L[i][j] = same(ia[i], ib[j]) ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1])
    }
    const out = []
    for (let i = 0, j = 0; i < a.length && j < b.length;) {
      if (same(ia[i], ib[j])) { out.push([a[i], b[j]]); i++; j++ } else if (L[i + 1][j] >= L[i][j + 1]) i++; else j++
    }
    return out
  }
  if (a.length !== b.length || ia.some((k, i) => k !== ib[i])) return []
  return b.map((x, i) => [a[i], x])
}

// The routine the API would store for `edit` pushed over `copy` (the same routine as the
// phone's copy holds it), before its stamps.
export function serverPutBack(copy, edit) {
  const out = clone(edit)
  keepKeys(copy, out, 'routines')
  return out
}

// Whether the API would store something other than `edit`: then it is not sent (routine-guard.js).
export function putBackChanges(copy, edit) {
  return !same(serverPutBack(copy, edit), edit)
}
