// The Exercises tab's filter pipeline, in one place so the tab and its filter sheet (record
// 0038) narrow the catalogue the same way: body part and search first, then the kind of
// exercise, then equipment. A type or equipment choice the earlier steps have narrowed away is
// ignored for the current view (never a dead end) but kept, so it comes back when it applies.
import { allExercises, equipmentOf, byCategory, searchExercises } from './exercises.js'
import { activeProfile, exAvailable } from './equipment.js'

/**
 * `{ S, q, bp, cat, eq, showAll }` → `{ catOpts, catOn, eqOpts, eqOn, list }`.
 * `list` is the narrowed catalogue in catalogue order (sorting is the caller's).
 */
export function libraryFilter({ S, q = '', bp = '', cat = '', eq = '', showAll = false }) {
  const profile = activeProfile(S)
  const inPart = searchExercises(allExercises(S).filter(e => !bp || e.bp === bp), q)
  const { opts: catOpts, on: catOn, list: base } = byCategory(inPart, cat)
  const eqFiltered = (profile && !showAll) ? base.filter(e => exAvailable(S, e)) : base
  const eqOpts = equipmentOf(eqFiltered)
  const eqOn = eqOpts.includes(eq) ? eq : ''
  return { catOpts, catOn, eqOpts, eqOn, list: eqOn ? eqFiltered.filter(e => e.eq === eqOn) : eqFiltered }
}
