// How the swap picker hands the exercise it picked back to the routine screen under it. The
// routine screen registers a callback before pushing /routine/pick?token=…; the picker delivers
// the id through the token and gets the callback's answer back (so an unsafe swap can be said on
// the picker before it closes). A module-level slot rather than route params: expo-router would
// have to navigate back *to* the routine with new params, and a callback keeps the routine
// screen's own state and the picker's answer in one place. One wait at a time; a stale token,
// or Back without a pick, reaches nothing.
let waiting = null
let seq = 0

export function waitForPick(onPick) {
  const token = String(++seq)
  waiting = { token, onPick }
  return token
}

// The callback's answer, or null when nothing waits for this token.
export function deliverPick(token, id) {
  if (!waiting || waiting.token !== token) return null
  return waiting.onPick(id)
}

export function endPick(token) {
  if (waiting?.token === token) waiting = null
}
