// The routine-level edits the Plan tab can make beyond one slot's sheet: new, duplicate, rename,
// add or remove a slot, the routine's progression rule, deload, and moving routines in the list.
// Pure: every function returns new objects and leaves its input alone. Nothing here deletes a key
// the server would put back (server-put-back.js): `excludeFromProgression` is the only routine key
// an edit may drop.
import { format, history, progression, routines as routinesLib } from '../shared/training.js'
import { putBackChanges } from './server-put-back.js'

// frontend/src/lib/glyphs.js DEFAULT_GLYPH. Not imported: that file pulls in Icon.jsx, which the
// shared-logic scan (and Node) cannot load.
const DEFAULT_GLYPH = 'figureStrength'
const clone = value => JSON.parse(JSON.stringify(value))
const nameOrNull = name => (typeof name === 'string' && name.trim() ? name.trim() : null)

// A routine with a name and no exercises yet, or null for a blank name.
export function newRoutine(name) {
  const trimmed = nameOrNull(name)
  return trimmed ? { id: format.uid(), name: trimmed, emoji: DEFAULT_GLYPH, ex: [] } : null
}

// routines.copyRoutine ("Push (Copy)", "Push (Copy 2)"), with the stamps taken off: the phone
// never invents or carries _ts/_f/_u, so the server stamps the copy as a new routine.
export function duplicateRoutine(routine) {
  const copy = routinesLib.copyRoutine(clone(routine))
  const bare = x => {
    delete x._ts
    delete x._f
    delete x._u
    return x
  }
  bare(copy)
  if (Array.isArray(copy.ex)) copy.ex.forEach(s => s && typeof s === 'object' && bare(s))
  return copy
}

// The routine with the trimmed name, or null when it is blank.
export function renamedRoutine(routine, name) {
  const trimmed = nameOrNull(name)
  return trimmed ? { ...clone(routine), name: trimmed } : null
}

// The web's quick-add (RoutineEdit.jsx:441): the exercise at the end with its default config.
// Adding an exercise the routine already has just appends a twin, which the server pairs safely.
export function routineWithSlotAdded(routine, exId) {
  const next = clone(routine)
  next.ex = [...(Array.isArray(next.ex) ? next.ex : []), { id: exId, ...history.defaultConfig(exId) }]
  return next
}

// The routine without the slot at `index`. `refused` says why it was not removed:
//  - 'superset': the slot is linked (the web's cleanup would delete its partner's superset name
//    and rest, which the server puts back);
//  - 'twin': the same exercise comes later in the routine (the server pairs slots differently);
//  - 'unsafe': the server would change the edit on its way in.
// Never runs the web's cleanupSg. A bad index gives { routine: null, refused: 'unsafe' }.
export function routineWithSlotRemoved(routine, index, base) {
  const ex = Array.isArray(routine?.ex) ? routine.ex : []
  const slot = Number.isInteger(index) ? ex[index] : null
  if (!slot) return { routine: null, refused: 'unsafe' }
  if (slot.sg) return { routine: null, refused: 'superset' }
  if (ex.slice(index + 1).some(s => s?.id === slot.id)) return { routine: null, refused: 'twin' }
  const next = clone({ ...routine, ex: ex.filter((_, i) => i !== index) })
  if (base && putBackChanges(base, next)) return { routine: null, refused: 'unsafe' }
  return { routine: next, refused: null }
}

// The routine's own rule (RoutineEdit.jsx:476). Always written, never cleared: the web never
// deletes `prog` and the server would put it back. Null for a rule the routine picker lacks.
export function routineWithProg(routine, prog) {
  if (!progression.POLICIES_FOR.reps.includes(prog)) return null
  return { ...clone(routine), prog }
}

// "Deload routine": on writes excludeFromProgression, off deletes it (the one key the server lets go).
export function routineWithDeload(routine, on) {
  const next = clone(routine)
  if (on) next.excludeFromProgression = true
  else delete next.excludeFromProgression
  return next
}

// The ids of the routines in order with the one at `index` moved up (-1) or down (+1), or null
// at an edge or for a bad index.
export function routinesMoved(routines, index, dir) {
  const ids = (routines ?? []).map(r => r.id)
  const to = index + dir
  if (!Number.isInteger(index) || (dir !== -1 && dir !== 1) || index < 0 || index >= ids.length || to < 0 || to >= ids.length) return null
  ;[ids[index], ids[to]] = [ids[to], ids[index]]
  return ids
}
