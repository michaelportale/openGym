// History for "last time" is the snapshot's workouts plus the finished workouts on the phone,
// merged by id with the phone's copy winning, oldest first.
const byDate = (a, b) => String(a.d ?? '').localeCompare(String(b.d ?? '')) || (a.start ?? 0) - (b.start ?? 0)

export function sessionState(snapshot, phoneWorkouts) {
  const state = snapshot?.state ?? {}
  const merged = new Map()
  for (const w of state.workouts ?? []) merged.set(w.id, w)
  for (const w of phoneWorkouts ?? []) merged.set(w.id, w)
  return { ...state, workouts: [...merged.values()].sort(byDate) }
}
