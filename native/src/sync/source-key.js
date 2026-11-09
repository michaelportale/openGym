// A cheap fingerprint of what a screen's source is built from, so a reload that finds it
// unchanged keeps what it built instead of parsing the server copy and redoing every model.
//
// The key holds the copy's rev and wid (its body is never read here), the ids of the workouts
// the server has not acked, this phone's pending weigh-ins (day, time, op) and today's date.
// That is enough because the sync engine stores each document whole with the server's rev and
// write id, a finished workout is only ever added or acked (unpaired, every one is unacked), a
// pending weigh-in's day and time change with its content (weigh-ins.js bumps t on a same-t
// rewrite), and an acked one leaves the list. The date moves "this week" and the ranges at midnight.

const localDay = now => {
  const x = new Date(now)
  return `${x.getFullYear()}-${x.getMonth() + 1}-${x.getDate()}`
}

export function sourceKey({ copyKey, workouts, weighIns, now }) {
  return JSON.stringify([
    copyKey ? [copyKey.rev ?? null, copyKey.wid ?? null] : null,
    (workouts ?? []).map(w => w?.id ?? null),
    (weighIns ?? []).map(r => [r.d, r.t, r.op]),
    localDay(now),
  ])
}

// Read from the stores: `weighIns` may be null for a screen that shows none. The pending rows
// come before the copy's key, as every reader here reads them (a sync stores the copy, then acks).
export async function readSourceKey({ finished, serverCopy, weighIns = null, now }) {
  const pendingWeighIns = weighIns ? await weighIns.listPending() : []
  const workouts = finished ? await finished.listPending() : []
  const copyKey = await serverCopy.key()
  return sourceKey({ copyKey, workouts, weighIns: pendingWeighIns, now })
}

// A load that hands back its last result while readKey(...args) gives the same key, and runs
// build(...args) only when it moved. A failed build keeps the old key, so the next call retries.
// The key is read before the build, so a change landing in between costs one more build, never a
// missed one.
export function keyed(readKey, build) {
  let last = null
  return async (...args) => {
    const key = await readKey(...args)
    if (last && last.key === key) return last.value
    const value = await build(...args)
    last = { key, value }
    return value
  }
}
