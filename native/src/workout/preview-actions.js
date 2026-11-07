export const PREVIEW_NOTICE = 'Preview with sample data. Nothing is logged, saved, or synced.'
export const PREVIEW_HINT = 'Preview only. Does not log, save, or sync.'

const ACTIONS = {
  completeSet: 'Complete set',
  addSet: 'Add set',
  addRest: 'Add 30 seconds',
  pauseRest: 'Pause rest'
}

// A press reports that the control is not live. It does not describe a recorded workout.
export function previewActionResult(id) {
  if (!Object.hasOwn(ACTIONS, id)) throw new Error(`Unknown preview action: ${id}`)
  return {
    outcome: 'unavailable',
    logged: false,
    saved: false,
    synced: false,
    message: `${ACTIONS[id]} is unavailable in this preview. Nothing was logged, saved, or synced.`
  }
}

export function upNextAccessibilityLabel(name) {
  if (typeof name !== 'string' || name.trim() === '') throw new Error('Up next needs a name')
  return `Up next, ${name}. Not available in this preview.`
}
