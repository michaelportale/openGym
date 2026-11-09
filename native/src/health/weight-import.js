// The weigh-in import's pure rules: which body-mass readings are external, the local day an
// import starts from, and the weigh-in operations a set of changed days needs. No I/O.

import { roundLb } from '../body/day-ops.js'
import { localDate } from '../session/timing.js'

// The sync id prefix of the app's own typed weigh-ins in Health (opengym-bw-<d>).
export const OWN_WEIGH_IN_PREFIX = 'opengym-bw-'

// External = another source's sample that is not one of the app's own weigh-ins. With no own
// bundle id nothing is external: the app's own samples could not be told apart.
export function isExternal(sample, ownBundleId) {
  if (typeof ownBundleId !== 'string' || ownBundleId === '' || sample.bundleId === ownBundleId) return false
  return !(typeof sample.syncId === 'string' && sample.syncId.startsWith(OWN_WEIGH_IN_PREFIX))
}

// The first millisecond of the local day holding ms, found by bisection so a day whose midnight
// does not exist (a clock change at 00:00) starts at its first real instant.
export function startOfLocalDay(ms, timeZone) {
  const day = localDate(ms, timeZone)
  let before = ms - 27 * 3600000 // surely an earlier local day
  let start = ms
  while (start - before > 1) {
    const mid = Math.floor((before + start) / 2)
    if (localDate(mid, timeZone) < day) before = mid
    else start = mid
  }
  return start
}

function latest(readings) {
  let best = null
  for (const r of readings) {
    if (!(roundLb(r.lb) > 0)) continue
    if (!best || r.at > best.at || (r.at === best.at && r.uuid > best.uuid)) best = r
  }
  return best
}

// The baseT a Health op carries: the t of the server copy's entry it replaces, or none.
function baseOf(copied) {
  const t = Number(copied?.t)
  return copied && Number.isFinite(t) ? { baseT: t } : {}
}

// Typed: no src 'health', or a Health entry whose weight is not its reading's. The web's sheet edits
// an entry in place, keeping src and hk, so the owner's typed weight looks imported. The reading's
// weight is the cache's, or else this phone's own import of it; an hk known to neither stays Health.
function isTyped(entry, lbByHk, local) {
  if (entry.src !== 'health') return true
  if (entry.hk == null) return false
  const lb = lbByHk[entry.hk] ?? (local?.op === 'set' && local.src === 'health' && local.hk === entry.hk ? local.w : undefined)
  return lb != null && Number(entry.w) !== roundLb(lb)
}

// For each changed day, the weigh-in op the import writes, if any. Inputs are keyed by day:
// readingsByDay - the day's cached external readings ({ uuid, lb, at }), deleted ones left out;
// entryByDay - the effective entry (the server copy with this phone's pending ops applied);
// copyByDay - the server copy's own entry, which every op names by its t (baseT), so the push
// replaces or removes only that entry (and an unsent typed removal is carried on);
// lbByHk - hk -> lb of the cached readings the days' entries name (deleted ones included);
// localOpByDay - this phone's row for the day ({ op, src, hk, ... , acked });
// deleted - the copy's deleted.bodyweight (day -> removal stamp).
// A typed entry wins its day. A reading this phone imported and
// another device then removed is not imported again; another reading is. That is the day being
// absent while this phone's row is a Health set with that hk which is acked, or which the
// removal on record already beats (deleted[d] >= its t: the push would supersede it).
export function dayOpsFromReadings({ days, readingsByDay = {}, entryByDay = {}, copyByDay = {}, lbByHk = {}, localOpByDay = {}, deleted = {}, now }) {
  const ops = []
  for (const d of days) {
    const entry = entryByDay[d] ?? null
    const local = localOpByDay[d]
    if (entry && isTyped(entry, lbByHk, local)) continue
    const beaten = local && (local.acked || Number(deleted[d]) >= local.t)
    const refused = !entry && beaten && local.op === 'set' && local.src === 'health' ? local.hk : null
    const best = latest((readingsByDay[d] ?? []).filter(r => r.uuid !== refused))
    const base = baseOf(copyByDay[d])
    if (best) {
      const w = roundLb(best.lb)
      if (entry && entry.hk === best.uuid && entry.w === w) continue
      const removed = Number(deleted[d]) || 0
      ops.push({ d, op: 'set', w, t: removed > 0 ? Math.max(now, removed + 1) : now, src: 'health', hk: best.uuid, ...base })
    } else if (entry) {
      ops.push({ d, op: 'remove', t: now, src: 'health', ...base })
    }
  }
  return ops
}
