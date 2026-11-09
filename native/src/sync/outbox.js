// What to send: the server's document, untouched, plus the workouts it does not have yet.
// Nothing else is changed, so keys this app does not know survive. The one addition: a document
// with no unit is sent as pounds, which this app logs in (the web, the carry-over and the MCP
// read a missing unit as kilograms).
export function buildPush(copy, pending) {
  const held = Array.isArray(copy.state.workouts) ? copy.state.workouts : []
  const have = new Set(held.map(w => w?.id))
  const add = []
  for (const w of pending) {
    if (have.has(w.id)) continue
    have.add(w.id)
    add.push(w)
  }
  if (!add.length) return null
  return {
    state: { ...copy.state, unit: copy.state.unit ?? 'lb', workouts: [...held, ...add] },
    baseRev: copy.rev,
    baseWid: copy.wid,
  }
}
