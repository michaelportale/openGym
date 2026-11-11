// Pure checks for a custom exercise: the draft the phone can save, where that id is still
// used, and whether a delete is allowed. Nothing here writes state or invents stamps.
import { equipment, exercises, format, mediaRefs, muscles } from '../shared/training.js'

const NAME_MAX = 80
const DESC_MAX = 1000

const isStored = stored => stored !== null && typeof stored === 'object'
const muscleNames = list => (Array.isArray(list) ? list : []).filter(m => typeof m === 'string')

// The id a duplicate check compares against. A brand-new exercise has none yet, so any
// existing name is a clash. uid() runs only once the draft is valid.
const prospectiveId = (input, stored) => {
  if (typeof input.id === 'string' && input.id !== '') return input.id
  if (isStored(stored) && stored.id != null && stored.id !== '') return stored.id
  return undefined
}

const countWhere = (list, key, id) => {
  if (!Array.isArray(list)) return 0
  let n = 0
  for (const item of list) {
    const entries = item && item[key]
    if (Array.isArray(entries) && entries.some(e => e && e.id === id)) n += 1
  }
  return n
}

// The exercise to save, or { error }. `stored` is the copy's row on an edit; a create omits it.
// The result starts as that row with the stamps taken off, then the edited fields overwrite.
export function customDraft(state, input, stored) {
  const name = typeof input.n === 'string' ? input.n.trim() : ''
  if (!name) return { error: 'Give it a name.' }
  if (name.length > NAME_MAX) return { error: 'Keep the name to 80 characters.' }
  if (!exercises.BODYPARTS.includes(input.bp)) return { error: 'Pick a body part.' }

  const storedEq = isStored(stored) && typeof stored.eq === 'string' ? stored.eq : null
  const eqKnown = equipment.ALL_EQUIPMENT.includes(input.eq)
  const eqKept = storedEq != null && !equipment.ALL_EQUIPMENT.includes(storedEq) && input.eq === storedEq
  if (!eqKnown && !eqKept) return { error: 'Pick equipment.' }

  const previous = isStored(stored) ? String(stored.n || '').trim() : ''
  const renamed = !isStored(stored) || name.toLowerCase() !== previous.toLowerCase()
  if (renamed) {
    const id = prospectiveId(input, stored)
    const existing = exercises.allExercises(state).find(e =>
      e && typeof e.n === 'string' && e.n.toLowerCase() === name.toLowerCase() && e.id !== id)
    if (existing) return { error: '\u201c' + existing.n + '\u201d already exists' }
  }

  const desc = String(input.desc ?? '').trim().slice(0, DESC_MAX)
  let url = null
  if (typeof input.url === 'string' && input.url.trim()) {
    url = mediaRefs.cleanUrl(input.url.trim())
    if (!url) return { error: 'That link is not a web address.' }
  }

  const primaries = input.bp === 'cardio'
    ? ['cardiovascular system']
    : muscles.inMuscleOrder(muscleNames(input.primaries))
  const secondaries = muscles.inMuscleOrder(muscleNames(input.secondaries).filter(m => !primaries.includes(m)))
  const tg = primaries.includes(input.tg)
    ? input.tg
    : (isStored(stored) && primaries.includes(stored.tg) ? stored.tg : (primaries[0] || ''))

  const exercise = isStored(stored) ? { ...stored } : {}
  delete exercise._ts
  delete exercise._f
  delete exercise._u
  delete exercise.edited
  delete exercise.trainingMetadata
  exercise.id = prospectiveId(input, stored) || ('c' + format.uid())
  exercise.n = name
  exercise.bp = input.bp
  exercise.eq = input.eq
  exercise.desc = desc
  exercise.primaries = primaries
  exercise.secondaries = secondaries
  exercise.sm = secondaries
  exercise.muscleGroups = [...primaries, ...secondaries]
  exercise.tg = tg
  exercise.custom = true
  if (url) exercise.url = url
  else delete exercise.url
  if (input.media !== null && typeof input.media === 'object') exercise.media = input.media
  else delete exercise.media
  return exercise
}

// How many routines and finished workouts name this id (once each), and whether the open
// session does. A null routine or workout is skipped.
export function customUsage(state, id, openEntries) {
  const source = state || {}
  return {
    routines: countWhere(source.routines, 'ex', id),
    workouts: countWhere(source.workouts, 'entries', id),
    open: Array.isArray(openEntries) && openEntries.some(e => e === id || (e && typeof e === 'object' && e.id === id)),
  }
}

// Refuses while the id is in the open session, then while any routine or workout still has it.
// An unused id is the delete marker and nothing else.
export function customDelete(state, id, openEntries) {
  const usage = customUsage(state, id, openEntries)
  if (usage.open) return { error: 'Finish your current workout first.' }
  if (usage.routines !== 0 || usage.workouts !== 0) {
    return {
      error: 'In ' + usage.routines + ' routines and ' + usage.workouts
        + ' workouts. Remove it from the routines first; it stays in your history.',
    }
  }
  return { value: { deleted: true } }
}
