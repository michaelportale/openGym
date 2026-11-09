import { hostOf, statusText } from './sync-status.js'

// The small decisions around when the phone syncs and what the screens show of it. Pure.

export const FOREGROUND_GAP_MS = 60_000

// Back in the app: sync if paired and the last attempt was a minute or more ago. A clock that
// moved backwards never holds it off.
export function shouldSyncOnForeground({ paired, lastAt, now }) {
  if (!paired) return false
  if (lastAt == null || now < lastAt) return true
  return now - lastAt >= FOREGROUND_GAP_MS
}

// What the Workout tab's data depends on from sync: who it is paired with and which server copy it holds (rev and wid), not when it last synced.
export function homeKey(status) {
  if (!status) return null
  return `${status.paired ? 1 : 0}|${status.server ?? ''}|${status.copyKey ?? ''}`
}

// One status seen by the Workout tab: the key it now counts as shown, and whether to reload the
// start screen (the key moved, and nothing was seen before is not a move). The key is held while
// the screen loads, since the load may have read the copy before it changed: a copy that lands
// during a load reloads the screen once the load is done. Never a reload while a session is open
// (or failed): the key moves on, as leaving the session reads the new copy anyway.
export function homeKeyStep({ seen, next, homeStatus }) {
  if (next === null || homeStatus === 'loading') return { seen, reload: false }
  return { seen: next, reload: homeStatus === 'start' && seen != null && seen !== next }
}

export function canPair({ address, code, busy }) {
  return !busy && address.trim() !== '' && code.trim() !== ''
}

export function serverLines(status) {
  const n = status?.pending ?? 0
  return {
    host: hostOf(status?.server) || 'Your server',
    profile: status?.profile ? status.profile : null,
    pending: n > 0 ? `${n} workout${n === 1 ? '' : 's'} waiting` : null,
    canResend: status?.problem === 'server-older',
    // Diagnostics' "Last synced" line, unless the status line already says when.
    lastSynced: !statusText(status).startsWith('Synced to '),
  }
}
