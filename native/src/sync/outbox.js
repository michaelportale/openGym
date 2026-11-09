// What to send: the server's document, untouched, plus the workouts it does not have yet.
// Nothing else in the document is read or changed, so keys this app does not know survive.
export function buildPush(copy, pending) {
  const held = Array.isArray(copy.state.workouts) ? copy.state.workouts : []
  const have = new Set(held.map(w => w.id))
  const add = []
  for (const w of pending) {
    if (have.has(w.id)) continue
    have.add(w.id)
    add.push(w)
  }
  if (!add.length) return null
  return {
    state: { ...copy.state, workouts: [...held, ...add] },
    baseRev: copy.rev,
    baseWid: copy.wid,
    added: add.map(w => w.id),
  }
}
