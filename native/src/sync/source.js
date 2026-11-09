// The Workout tab's data: the server copy once paired, else the bundled snapshot. Both give
// { state, names, example }, so nothing downstream knows which it got.
import { readCopy } from './server-copy.js'
import { exercises } from '../shared/training.js'
import { sessionState } from '../workout/history-state.js'

const cap = s => (s ? s[0].toUpperCase() + s.slice(1) : '')

function nameOf(id, builtIn, custom) {
  const c = custom.get(id)
  if (c) return { name: cap(c.n || ''), category: [c.tg, c.eq].filter(Boolean).map(cap).join(' · ') }
  const b = builtIn.get(id)
  if (b) return { name: cap(b.n || ''), category: [b.bp, b.eq].filter(Boolean).map(cap).join(' · ') }
  return null
}

const BUILT_IN = new Map(exercises.EXDB.map(e => [e.id, e]))

function namesFor(state) {
  const builtIn = BUILT_IN
  const custom = new Map((state.customEx ?? []).map(e => [e.id, e]))
  const names = {}
  const note = id => {
    if (names[id]) return
    const n = nameOf(id, builtIn, custom)
    if (n?.name) names[id] = n
  }
  for (const r of state.routines ?? []) for (const e of r.ex ?? []) note(e.id)
  for (const w of state.workouts ?? []) for (const e of w.entries ?? []) note(e.id)
  return names
}

const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v)
// A list from the server's document as the screen reads it: its objects only, each passed through
// `each`. A value that is not a list reads as an empty one; a missing one stays missing.
const listed = (obj, key, each = x => x) =>
  (obj[key] === undefined ? {} : { [key]: (Array.isArray(obj[key]) ? obj[key].filter(isObj) : []).map(each) })

// The server's document arrives as the file holds it, so one malformed entry (a null workout, a
// null exercise in a routine) must not stop the tab. The screen reads routines, workouts and
// custom exercises, and the lists inside them, as objects only. The stored copy is never changed:
// a push sends it as it is.
function readable(state) {
  return {
    ...state,
    ...listed(state, 'routines', r => ({ ...r, ...listed(r, 'ex') })),
    ...listed(state, 'workouts', w => ({ ...w, ...listed(w, 'entries', e => ({ ...e, ...listed(e, 'sets') })) })),
    ...listed(state, 'customEx'),
  }
}

// `example`: whether the screen shows the example snapshot, and so its banner. Never over the copy.
export function screenSource({ copy, bundled, pending }) {
  if (!copy) return { state: sessionState(bundled, pending), names: bundled.names, example: bundled.example === true }
  const doc = readable(copy.state)
  // Acked workouts are in the copy and it wins; only unsent ones are added.
  const held = new Set((doc.workouts ?? []).map(w => w.id))
  const state = sessionState({ state: doc }, (pending ?? []).filter(w => !held.has(w.id)))
  return { state, names: namesFor(state), example: false }
}

// What the Workout tab opens on, read from the stores: `finished` (the finished-workout store)
// and `serverCopy`. Paired: the server copy, plus the workouts it has not acked. Not paired: the
// bundled snapshot plus every workout on the phone. `workouts` is every workout on the phone.
// A copy the screen still cannot build from reads as no copy, as a corrupt one does.
// The unsent workouts are read before the copy: the sync engine stores a copy before it acks the
// workouts that copy holds, so a sync landing between the two reads leaves each workout in one.
export async function readScreenSource({ finished, serverCopy, bundled }) {
  const workouts = await finished.list()
  const pending = await finished.listPending()
  const copy = await readCopy(serverCopy)
  if (copy) {
    try {
      return { ...screenSource({ copy, bundled, pending }), workouts }
    } catch {
      // falls through to the bundled snapshot
    }
  }
  return { ...screenSource({ copy: null, bundled, pending: workouts }), workouts }
}
