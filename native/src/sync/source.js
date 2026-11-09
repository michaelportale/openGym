// The Workout tab's data: the server copy once paired, else the bundled snapshot. Both give
// { state, names }, so nothing downstream knows which it got.
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

function namesFor(state) {
  const builtIn = new Map(exercises.EXDB.map(e => [e.id, e]))
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

export function screenSource({ copy, bundled, pending }) {
  if (!copy) return { state: sessionState(bundled, pending), names: bundled.names }
  // Acked workouts are in the copy and it wins; only unsent ones are added.
  const held = new Set((copy.state.workouts ?? []).map(w => w.id))
  const state = sessionState(copy, (pending ?? []).filter(w => !held.has(w.id)))
  return { state, names: namesFor(state) }
}
