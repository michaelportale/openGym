// History for "last time" is the snapshot's workouts plus the finished workouts on the phone,
// merged by id with the phone's copy winning, oldest first. Older workouts have no id; they
// are keyed by date|start, as the server does (api/sync-stamps.js).
const keyOf = w => (w.id != null ? w.id : `${w.d}|${w.start}`)
const byDate = (a, b) => String(a.d ?? '').localeCompare(String(b.d ?? '')) || (a.start ?? 0) - (b.start ?? 0)

export function sessionState(snapshot, phoneWorkouts) {
  const state = snapshot?.state ?? {}
  const merged = new Map()
  for (const w of state.workouts ?? []) merged.set(keyOf(w), w)
  for (const w of phoneWorkouts ?? []) merged.set(keyOf(w), w)
  return { ...state, workouts: [...merged.values()].sort(byDate) }
}
