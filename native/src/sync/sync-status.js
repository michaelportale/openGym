// The sync state in one plain sentence for the saved screen and Diagnostics. It names the
// server by its host only (never the scheme, port or path), and the time in the device's own
// h:mm form. Formatters can be passed in so tests do not depend on the machine's zone or locale.

const defaultTime = ms => new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
const defaultDay = ms => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

const SAFE = 'Your workouts are safe on this phone'

const PROBLEMS = {
  unpaired: host => `${host} signed this phone out. Saved on this phone; pair again to sync.`,
  'server-older': host => `${host} has older data than this phone last saw, as if restored from a backup. Nothing was sent. ${SAFE}; send them again to put them back.`,
  conflict: host => `${host} kept changing while this phone synced. ${SAFE}; it will try again.`,
  // The API takes a document up to 5 MB (api/server.js MAX_BODY), as does the bundled nginx on
  // /api; a proxy in front with a smaller body limit is what an owner can change
  // (docs/SELF_HOSTING.md, Troubleshooting: 413).
  'too-large': () => 'Your server refused the upload because it is too large. Your workouts stay on this phone. If a proxy sits in front of the server, raise its upload limit to at least 5 MB (see the self-hosting guide).',
  refused: (_host, s) => `Your server refused this phone's workouts${s.httpStatus ? ` (error ${s.httpStatus})` : ''}. Nothing was overwritten. They stay on this phone.`,
  error: () => 'Saved on this phone. Syncing stopped on an error here; it will try again.',
}

// 'https://gym.example.com' -> 'gym.example.com'; 'http://[fd00::1]:3000' -> 'fd00::1'.
export function hostOf(base) {
  if (typeof base !== 'string' || !base) return ''
  const authority = base.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').split(/[/?#]/)[0]
  if (authority.startsWith('[')) {
    const end = authority.indexOf(']')
    return end > 0 ? authority.slice(1, end) : authority
  }
  const colon = authority.lastIndexOf(':')
  return colon >= 0 ? authority.slice(0, colon) : authority
}

export function statusText(status, { now, server, formatTime = defaultTime, formatDay = defaultDay } = {}) {
  const s = status || {}
  // Same calendar day on this device: the time alone. Otherwise the day as well.
  const syncedLine = (host, at) => `Synced to ${host}${now != null && formatDay(at) !== formatDay(now) ? ` on ${formatDay(at)}` : ''} at ${formatTime(at)}`
  const host = hostOf(server ?? s.server) || 'Your server'
  if (!s.paired || s.state === 'unpaired') {
    return s.problem === 'unpaired' ? PROBLEMS.unpaired(host) : 'Not paired. Saved on this phone.'
  }
  if (s.state === 'syncing') return `Saved on this phone. Syncing with ${host}…`
  if (s.state === 'problem') {
    const words = PROBLEMS[s.problem]
    return words ? words(host, s) : 'Saved on this phone. Syncing stopped on a problem; it will try again.'
  }
  if (s.pending > 0) return `Saved on this phone. It will sync when ${host} is reachable.`
  const at = Date.parse(s.lastSyncedAt ?? '')
  const synced = Number.isFinite(at)
  // Nothing to send: say what is true, not that something is waiting.
  if (s.state === 'waiting') return synced ? `${syncedLine(host, at)}. ${host} isn't reachable right now.` : `Paired with ${host}. Not reachable right now.`
  if (!synced) return `Paired with ${host}. Not synced yet.`
  return syncedLine(host, at)
}
