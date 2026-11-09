// A long absence with the keypad sheet open. Pure: the caller passes the clock.
export const LONG_ABSENCE_MS = 5 * 60 * 1000

// True when the app was away at least 5 minutes. No `backgroundedAt` (it never left) is false.
export function closeSheetOnReturn(backgroundedAt, now) {
  if (backgroundedAt == null || now == null) return false
  return now - backgroundedAt >= LONG_ABSENCE_MS
}

// Closing is safe only if nothing typed would be lost: nothing was typed, or the set's stored draft
// holds exactly what is on the sheet (so a failed background draft write keeps the sheet open).
export function typedNumbersKept(changed, stored, values) {
  if (!changed) return true
  return stored != null && JSON.stringify(stored) === JSON.stringify(values)
}

// The whole close-on-return decision: away 5+ minutes and the typed numbers are safe.
export function closeOnReturn({ left, now, kept }) {
  return kept === true && closeSheetOnReturn(left, now)
}
