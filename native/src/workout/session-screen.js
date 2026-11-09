import { history } from '../shared/training.js'
import { DURATION_GAP_MS, clampMs } from '../session/timing.js'
import { lastTime } from './last-time.js'
import { clock, isDone, isWarmup } from './workout-view.js'

// What the session screen derives from the engine's view, the stored base and the history.

// The engine's view entries carry no target. Each takes its base entry's (by id) so the
// per-hand load and the exercise's own rest apply. An added exercise has none.
export function withTargets(view, base) {
  if (!view) return view
  const targets = new Map((base?.entries ?? []).map(entry => [entry.id, entry.target]))
  return { ...view, entries: (view.entries ?? []).map(entry => ({ ...entry, target: targets.get(entry.id) })) }
}

// "Last time" for every exercise in the session, looked up once when it opens.
export function lastTimesFor(state, base) {
  const routineId = base?.routineIds?.[0]
  return Object.fromEntries((base?.entries ?? []).map(entry => [entry.id, lastTime(state, entry.id, routineId)]))
}

// The engine computes the view only when an action runs. Between actions the rest counts down
// from its stored deadline and the clock runs on from that read, within the engine's gap rule.
export function liveView(view, takenAt, now) {
  if (!view) return view
  const tail = now - takenAt
  const running = view.status === 'active' && view.disposition?.kind === 'active'
  const elapsedMs = (view.elapsedMs || 0) + (running && tail > 0 && tail <= DURATION_GAP_MS ? tail : 0)
  let rest = view.rest
  if (rest && rest.status === 'running') {
    const remainingMs = clampMs(rest.deadline - now, rest.totalMs)
    rest = { ...rest, remainingMs, status: remainingMs === 0 ? 'complete' : 'running' }
  }
  return { ...view, elapsedMs, rest }
}

const workSets = entry => (entry?.sets ?? []).filter(slot => !isWarmup(slot))

// After a Complete, an exercise picked by hand stays on screen while it has a set left; after its
// last set the screen follows the first exercise with one (null means follow). A completed
// warm-up (`setId`) moves nothing.
export function shownAfterComplete(view, shownIndex, setId) {
  if (shownIndex == null) return null
  const completed = (view?.entries ?? []).flatMap(entry => entry.sets ?? []).find(slot => slot.setId === setId)
  if (completed && isWarmup(completed)) return shownIndex
  return workSets(view?.entries?.[shownIndex]).some(slot => !isDone(slot)) ? shownIndex : null
}

const thousands = n => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')

// The finish confirmation: done sets (both sides, per side), the volume the saved workout
// will carry (the web's workoutVolume, so a per-hand load counts both bells), and the time.
export function finishSummary(view) {
  const entries = view?.entries ?? []
  const sets = entries.reduce((n, entry) => n + workSets(entry).filter(isDone).length, 0)
  const volume = history.workoutVolume({
    entries: entries.map(entry => ({ id: entry.id, target: entry.target, sets: (entry.sets ?? []).map(slot => slot.row) })),
  })
  return {
    setsText: `${sets} ${sets === 1 ? 'set' : 'sets'}`,
    volumeText: `${thousands(volume)} lb`,
    durationText: clock(view?.elapsedMs),
  }
}
