import { trainingMetadataOf } from './training-metadata.js'
import { equipmentMatch } from './equipment.js'
import { hasCompletedWork, isWarmupRow } from './workout-model.js'

// Legacy target/equipment ordering remains available for callers. New swap suggestions use
// explicit training metadata and completed-session familiarity below.

/** The target muscle a swap away from `ex` should start on, or '' when it has none. */
export const swapMuscleOf = ex => (ex && typeof ex.tg === 'string' ? ex.tg : '')

/**
 * The exercises in `list` sharing `ex`'s target muscle, `ex` itself left out, those on its
 * equipment first. Otherwise the list's own order is kept (Array#sort is stable), so favourites
 * floated to the top earlier stay on top within each half.
 */
export function sameMuscleFirst(list, ex) {
  const tg = swapMuscleOf(ex)
  if (!tg) return []
  const eq = ex.eq || ''
  return list
    .filter(e => e && e.tg === tg && e.id !== ex.id)
    .sort((a, b) => Number(!!eq && b.eq === eq) - Number(!!eq && a.eq === eq))
}

// Related movement planes remain a weaker match, even when their primary targets overlap.
const relatedRoles = [['horizontal-press', 'vertical-press'], ['horizontal-pull', 'vertical-pull']]

/** Rank available alternatives by verified suitability, then completed-session familiarity. */
export function rankReplacements({ exercise, candidates = [], profile, excludedStationIds = [], workouts = [], metadata = {} }) {
  if (!exercise) return []
  const info = ex => trainingMetadataOf({ ...ex, ...(metadata[ex.id] ? { trainingMetadata: metadata[ex.id] } : {}) })
  const source = info(exercise)
  const verified = value => value.status !== 'unknown' && !!value.role && value.primary?.length > 0
  const uses = {}
  for (const workout of workouts) {
    const ids = new Set((workout.entries || []).filter(e => (e.sets || []).some(s => hasCompletedWork(s) && !isWarmupRow(s))).map(e => e.id))
    for (const id of ids) uses[id] = (uses[id] || 0) + 1
  }
  const result = []
  for (const candidate of candidates) {
    if (!candidate || candidate.id === exercise.id || !equipmentMatch(profile, candidate, excludedStationIds).available) continue
    const target = info(candidate)
    const shared = source.primary.some(m => target.primary.includes(m))
    const known = verified(source) && verified(target)
    // Legacy catalogue targets still permit a cautious fallback, never a role equivalence.
    if (!shared && !((!source.primary.length || !target.primary.length) && swapMuscleOf(exercise) && swapMuscleOf(candidate) === swapMuscleOf(exercise))) continue
    const same = known && shared && source.role === target.role
    const related = known && shared && relatedRoles.some(pair => pair.includes(source.role) && pair.includes(target.role))
    const tier = !known ? 'unknown' : same ? 'same-role' : related ? 'related-role' : 'same-muscle'
    const reasons = [!known ? 'Training metadata unverified' : same ? 'Same role and primary target' : related ? 'Related role and primary target' : 'Same muscle, different role']
    if (uses[candidate.id]) reasons.push('Used in completed workouts')
    result.push({ exercise: candidate, tier, reasons })
  }
  const order = { 'same-role': 0, 'related-role': 1, 'same-muscle': 2, unknown: 3 }
  return result.sort((a, b) => order[a.tier] - order[b.tier] || (uses[b.exercise.id] || 0) - (uses[a.exercise.id] || 0) || (a.exercise.id < b.exercise.id ? -1 : a.exercise.id > b.exercise.id ? 1 : 0))
}
