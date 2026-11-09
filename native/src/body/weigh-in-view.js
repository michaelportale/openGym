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
