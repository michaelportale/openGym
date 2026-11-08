// State -> snapshot. Node tooling: it may import the web app's lib directly (app code may not).
import { EXDB } from '../../frontend/src/lib/exercises-data.js'
import { buildSessionEntries } from '../../frontend/src/lib/session-start.js'

// Everything building a session reads, and nothing personal (no body, measurements, notes, reminders).
// trainingMetadata is per-exercise info the session builder reads; the bar, plate and dumbbell
// keys are the inventory settings the spec keeps.
export const SNAPSHOT_KEYS = ['unit', 'restSec', 'routines', 'rotation', 'queue', 'scheduleMode', 'workouts', 'customEx', 'exWeights', 'startFrom', 'equipProfiles', 'activeEquipId', 'dayPlan', 'trainingMetadata', 'barWeights', 'plates', 'loadKind', 'dbLoad', 'dumbbells']

const cap = s => (s ? s[0].toUpperCase() + s.slice(1) : '')

function nameOf(id, builtIn, custom) {
  const c = custom.get(id)
  if (c) return { name: cap(c.n || ''), category: [c.tg, c.eq].filter(Boolean).map(cap).join(' · ') }
  const b = builtIn.get(id)
  if (b) return { name: cap(b.n || ''), category: [b.bp, b.eq].filter(Boolean).map(cap).join(' · ') }
  return null
}

export function toSnapshot(state, catalogue = EXDB) {
  if (state?.unit !== 'lb') throw new Error('snapshot needs a pound profile (unit is not lb)')
  if (!Array.isArray(state.routines) || !state.routines.length) throw new Error('snapshot needs routines, found none')
  const builtIn = new Map(catalogue.map(e => [e.id, e]))
  const custom = new Map((state.customEx || []).map(e => [e.id, e]))
  const names = {}
  for (const r of state.routines) {
    for (const e of r.ex || []) {
      const n = nameOf(e.id, builtIn, custom)
      if (!n?.name) throw new Error(`exercise ${e.id} in "${r.name}" has no name`)
      names[e.id] = n
    }
  }
  // History ids only need a name where one is known; an exercise deleted long ago is not an error
  for (const w of state.workouts || []) {
    for (const e of w.entries || []) {
      const n = names[e.id] ? null : nameOf(e.id, builtIn, custom)
      if (n?.name) names[e.id] = n
    }
  }
  const kept = {}
  for (const k of SNAPSHOT_KEYS) if (state[k] !== undefined) kept[k] = state[k]
  return { version: 1, example: false, state: kept, names }
}

// The allowlist must not change what a session is built from
export function assertSameSessions(fullState, snapshot) {
  for (const r of fullState.routines) {
    const a = JSON.stringify(buildSessionEntries(fullState, r))
    const b = JSON.stringify(buildSessionEntries(snapshot.state, r))
    if (a !== b) throw new Error(`snapshot builds ${r.name} differently`)
  }
}
