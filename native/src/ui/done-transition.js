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
