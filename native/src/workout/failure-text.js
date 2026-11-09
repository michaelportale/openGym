// Engine codes never reach the owner. A refused write reads as what was not done, then why, in
// plain words: "Set not saved. The phone couldn't write it. Try again."

export const OVERNIGHT_NOTICE = 'Choose Resume, Finish or Discard first.'

// What the screen was doing when the write was refused.
const NOT_DONE = {
  open: "Workout didn't open.",
  complete: 'Set not saved.',
  'complete-warmup': 'Warm-up not saved.',
  rest: "Rest didn't start.",
  'start-rest': "Rest didn't start.",
  draft: 'Numbers not saved.',
  edit: 'Change not saved.',
  undo: 'Set not undone.',
  'undo-warmup': 'Warm-up not undone.',
  'add-set': 'Set not added.',
  'add-warmup': 'Warm-up not added.',
  'add-warmups-partial': "One warm-up added; the other didn't save. Use Add warm-up to add it.",
  'remove-warmup': 'Warm-up not removed.',
  'add-time': 'Time not added.',
  'skip-rest': 'Rest not skipped.',
  'pause-rest': 'Rest not paused.',
  'resume-rest': 'Rest not resumed.',
  resume: 'Workout not resumed.',
  discard: 'Workout not deleted.',
  finish: 'Workout not saved.',
}

// Every code the screen can receive: each failure('…') and code: '…' in session/session.js and
// session/session-controller.js. 'failed' (the controller's fallback) reads as the generic reason.
const WHY = {
  storage: "The phone couldn't write it. Try again.",
  'unknown-set': 'That set is no longer in this workout.',
  'known-set': 'That set is already in this workout.',
  'last-set': 'An exercise needs at least one set.',
  'unknown-exercise': 'That exercise is no longer in this workout.',
  'known-exercise': 'That exercise is already in this workout.',
  'last-exercise': 'A workout needs at least one exercise.',
  'bad-index': "That spot isn't in this workout.",
  'bad-deadline': "Its end time couldn't be worked out.",
  'no-rest': 'No rest is running.',
  'bad-extend': "The rest can't get any longer.",
  'bad-note': "That note couldn't be read.",
  'note-too-long': 'A note can be up to 2,000 characters.',
  discarded: 'This workout was deleted.',
  finished: 'This workout has already ended.',
  'not-overnight': 'This workout is already running.',
  'bad-end': "Its end time couldn't be worked out.",
  'end-before-start': 'The end time is before the workout started.',
  'not-ready': "This workout isn't open yet.",
  sender: "Saving isn't set up on this phone.",
  payload: "The workout couldn't be put together for saving.",
  send: "It didn't reach your history. Try again.",
  'not-saved': "The save wasn't confirmed. Try again.",
}

// Opening reads the journal, so storage failing there could not read it, not write it.
const OPEN_WHY = { storage: "The phone couldn't read it. Try again." }

const GENERIC = 'Something went wrong. Try again.'

// Own keys only: a code such as 'constructor' must not find Object.prototype's.
const lookup = (table, key) => (typeof key === 'string' && Object.hasOwn(table, key) ? table[key] : null)

// One sentence for a refused write's code. `action` is what was tapped (a key of NOT_DONE).
// An overnight refusal keeps stage 1's sentence whatever was tapped.
export function failureText(code, { action } = {}) {
  if (code === 'overnight') return OVERNIGHT_NOTICE
  if (action === 'add-warmups-partial') return NOT_DONE[action]
  const why = (action === 'open' ? lookup(OPEN_WHY, code) : null) ?? lookup(WHY, code) ?? GENERIC
  return `${lookup(NOT_DONE, action) ?? 'Not saved.'} ${why}`
}
