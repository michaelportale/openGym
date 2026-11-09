// A Done mark pops only when a set the card has already shown goes from open to done. The card
// keeps the last status it saw per set id, which survives SetRow swapping its root element when a
// row stops being open. An unknown id (first render, remount, a new exercise) never pops.
export function statusBySetId(rows) {
  return new Map(rows.map(row => [row.setId, row.status]))
}

export function poppedSetIds(previous, rows) {
  const popped = new Set()
  if (!previous) return popped
  for (const { setId, status } of rows) {
    const before = previous.get(setId)
    if (before !== undefined && before !== 'done' && status === 'done') popped.add(setId)
  }
  return popped
}

// How the Done mark draws: { from, ms }. It pops (starts at 0 and grows over `ms`) only where `pop`
// turns on, which includes a mount with `pop` set (the row swapped its root), and only with a
// duration. With none (Reduce Motion, or the flag before any read resolved) it is drawn full size.
// `wasPop` is the previous render's `pop` (false on mount): a duration that arrives later, while
// `pop` is still set, never pops a mark already drawn full size.
export function donePop(wasPop, pop, ms) {
  return pop && !wasPop && ms > 0 ? { from: 0, ms } : { from: 1, ms: 0 }
}
