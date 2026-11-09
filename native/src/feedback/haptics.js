import { writeOutcome } from '../workout/set-calls.js'

// Which system haptic an event earns, or null. Three events only: a set saved, a rest that ends
// while the app is open, a write that failed. Pure; haptics-adapter.js plays it.
const KINDS = { 'set-saved': 'success', 'rest-ended': 'warning', 'write-failed': 'error' }
export const hapticFor = event => KINDS[event] ?? null

// The haptic a settled write earns. A Complete that committed (a warm-up's too: every Complete is
// tagged 'complete') is a saved set, even if its rest did not start or a warning shows; any write whose failure notice shows is a failure (the same
// classification as the screen's notice); nothing else makes one. A dropped tap makes none.
// `tapped: false` is a write the owner did not tap (a swipe-away's draft, the rest restored on open):
// it never buzzes, a failure included; its notice still shows.
export function hapticForWrite(action, result, { tapped = true } = {}) {
  if (!tapped || !result || result.ignored) return null
  if (writeOutcome(result, action)?.kind === 'failed') return hapticFor('write-failed')
  if (action === 'complete' && result.saved === true && result.ok !== false) return hapticFor('set-saved')
  return null
}

// True only on a live crossing: the previous tick was running with time left, this one is complete
// with the same deadline, and the app is in front. No `prev` (the first tick after returning from
// the background, or no rest before) is never a crossing; a paused rest never ends.
export function restEndedNow(prev, next, appActive) {
  return (
    appActive === true &&
    prev?.status === 'running' &&
    prev.remainingMs > 0 &&
    next?.status === 'complete' &&
    next.deadline === prev.deadline
  )
}
