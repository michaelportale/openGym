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
  'too-large': host => `${host} refused the update as too large. ${SAFE}.`,
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
  const host = hostOf(server ?? s.server) || 'Your server'
  if (!s.paired || s.state === 'unpaired') {
    return s.problem === 'unpaired' ? PROBLEMS.unpaired(host) : 'Not paired. Saved on this phone.'
  }
  if (s.state === 'syncing') return `Syncing with ${host}…`
  if (s.state === 'problem') {
    const words = PROBLEMS[s.problem]
    return words ? words(host) : 'Saved on this phone. Syncing stopped on a problem; it will try again.'
  }
  if (s.state === 'waiting' || s.pending > 0) return `Saved on this phone. It will sync when ${host} is reachable.`
  const at = Date.parse(s.lastSyncedAt ?? '')
  if (!Number.isFinite(at)) return `Paired with ${host}. Not synced yet.`
  // Same calendar day on this device: the time alone. Otherwise the day as well.
  const day = now != null && formatDay(at) !== formatDay(now) ? ` on ${formatDay(at)}` : ''
  return `Synced to ${host}${day} at ${formatTime(at)}`
}
