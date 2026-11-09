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

// Reload the start screen when the key moved. Never while a session is open (or loading or failed):
// leaving then reads the new copy anyway.
export function shouldReloadHome({ prev, next, homeStatus }) {
  if (homeStatus !== 'start') return false
  if (prev === undefined || prev === null || next === null) return false
  return prev !== next
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
