import { whyThis } from '../science/rules.js'

// Which science-register entry a "Why this?" control opens. The ids are checked against
// whyThis() in the test. `payload()` resolves it with a literal id, which the science audit needs.
// An unknown kind has no entry, so a control cannot open a blank sheet.
const ENTRIES = Object.freeze({
  rest: { id: 'rest-defaults', payload: () => whyThis('rest-defaults'), title: 'About rest times' },
  increments: { id: 'load-increments', payload: () => whyThis('load-increments'), title: 'About load steps' },
  'warmup-loads': { id: 'warmup-loads', payload: () => whyThis('warmup-loads'), title: 'Why these warm-up loads' },
  'warmup-prompt': { id: 'warmup-prompt', payload: () => whyThis('warmup-prompt'), title: 'Why a warm-up is offered' },
  progression: { id: 'double-progression', payload: () => whyThis('double-progression'), title: 'Why this progression' },
  effort: { id: 'effort-proximity', payload: () => whyThis('effort-proximity'), title: 'Why this effort' },
  'bodyweight-trend': { id: 'bodyweight-trend', payload: () => whyThis('bodyweight-trend'), title: 'Why a 7-day average' },
  'e1rm-formula': { id: 'e1rm-formula', payload: () => whyThis('e1rm-formula'), title: 'Why this e1RM' },
  deload: { id: 'deload-after-misses', payload: () => whyThis('deload-after-misses'), title: 'Why a deload' }
})

/** @returns {{ id: string, title: string, payload: () => object } | null} */
export function whyEntry(kind) {
  return Object.hasOwn(ENTRIES, kind) ? { ...ENTRIES[kind] } : null
}
