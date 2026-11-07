import { exercises } from '../shared/training.js'
import { whyThis } from './rules.js'

// The PRD says "muscle group" and does not name a field. The catalogue body part is the
// group the data already has (chest, back, and so on).
export function muscleGroupOf(exerciseOrId) {
  const id = exerciseOrId && typeof exerciseOrId === 'object' ? exerciseOrId.id : exerciseOrId
  const group = exercises.EXIDX[id]?.bp
  return typeof group === 'string' && group.trim() ? group : null
}

/** Prompt a warm-up on the first exercise in the session for each body part. */
export function warmupPrompts(exerciseIds) {
  const seen = new Set()
  return (Array.isArray(exerciseIds) ? exerciseIds : []).map(exerciseOrId => {
    const id = exerciseOrId && typeof exerciseOrId === 'object' ? exerciseOrId.id : exerciseOrId
    const group = muscleGroupOf(id)
    const prompt = group != null && !seen.has(group)
    if (group) seen.add(group)
    return { id, group, prompt }
  })
}

export function warmupPromptWhy() {
  return whyThis('warmup-prompt')
}
