// Pure helpers for the "Log weight" sheet. No I/O.
import { roundLb } from './day-ops.js'

// Typed text to pounds rounded to 0.1, or null. A comma counts as the decimal separator.
export function parseWeight(text) {
  if (typeof text !== 'string') return null
  const clean = text.trim().replace(',', '.')
  if (!/^\d*\.?\d*$/.test(clean) || clean === '' || clean === '.') return null
  const value = Number(clean)
  if (!(value > 0 && value <= 1000)) return null
  const w = roundLb(value)
  return w > 0 ? w : null
}

export function todayLine(entry) {
  if (!entry) return 'No weight logged today.'
  return `Today: ${Number(entry.w).toFixed(1)} lb${entry.src === 'health' ? ' (from Apple Health)' : ''}`
}

// Removal is offered only for today's entry when it is this phone's own typed set: `row` is
// this phone's row for the day. A Health or web-typed entry is never removed from here.
export function canRemove(entry, row) {
  return Boolean(entry && row && row.op === 'set' && row.src == null && entry.src == null && entry.t === row.t)
}

// The op a typed save writes. Its stamp beats now, this phone's own typed entry for the day and a
// deletion stamp, so the save wins over both; a Health entry is no floor (a typed weight beats it anyway).
export function saveOp({ d, w, now, entry, deleted }) {
  const floors = [now, entry && !entry.src ? Number(entry.t) + 1 : NaN, Number(deleted?.[d]) > 0 ? Number(deleted[d]) + 1 : NaN]
  return { d, op: 'set', w: roundLb(w), t: Math.max(...floors.filter(Number.isFinite)) }
}

// The sheet's two action buttons; busy is 'save', 'remove' or null. The busy one says what is happening.
export function sheetButtons(busy) {
  const remove = "Remove today's weight"
  return {
    save: busy === 'save' ? { label: 'Saving…', a11y: 'Saving' } : { label: 'Save', a11y: 'Save' },
    remove: busy === 'remove' ? { label: 'Removing…', a11y: 'Removing' } : { label: remove, a11y: remove },
  }
}

// The work after a weigh-in is written: the Health pass, then the server sync. The order matters: after
// "Remove today's weight" the Health fallback must replace the unsent remove before the push is built.
// Otherwise the server's deletion stamp beats the fallback and the reading is refused for good.
// The sync runs even if the pass rejects (both callers never reject today).
export function afterWeighIn(healthPass, serverSync) {
  return healthPass().then(() => serverSync(), () => serverSync())
}
