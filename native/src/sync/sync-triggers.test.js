import { describe, expect, test } from 'vitest'
import { FOREGROUND_GAP_MS, canPair, focusReloads, homeKey, homeKeyStep, reloadsOnFocus, serverLines, shouldSyncOnForeground } from './sync-triggers.js'
import { sourceKey } from './source-key.js'

describe('shouldSyncOnForeground', () => {
  const T = 1_000_000
  test('only when paired, and at most once a minute', () => {
    expect(shouldSyncOnForeground({ paired: false, lastAt: null, now: T })).toBe(false)
    expect(shouldSyncOnForeground({ paired: true, lastAt: null, now: T })).toBe(true)
    expect(shouldSyncOnForeground({ paired: true, lastAt: T - FOREGROUND_GAP_MS + 1, now: T })).toBe(false)
    expect(shouldSyncOnForeground({ paired: true, lastAt: T - FOREGROUND_GAP_MS, now: T })).toBe(true)
  })
  test('a clock that went backwards does not hold sync off', () => {
    expect(shouldSyncOnForeground({ paired: true, lastAt: T + 5000, now: T })).toBe(true)
  })
})

describe('homeKey / reload', () => {
  const st = (over = {}) => ({ paired: true, server: 'https://g.example.com', copyKey: '4|w4', lastSyncedAt: 'a', ...over })
  const k = over => homeKey(st(over))
  test('the first status only records the key', () => {
    expect(homeKeyStep({ seen: undefined, next: k(), homeStatus: 'start' }).reload).toBe(false)
  })
  test('a new server copy, pairing or forgetting reloads the start screen', () => {
    expect(homeKeyStep({ seen: k(), next: k({ copyKey: '5|w5' }), homeStatus: 'start' }).reload).toBe(true)
    expect(homeKeyStep({ seen: k(), next: homeKey({ paired: false }), homeStatus: 'start' }).reload).toBe(true)
    expect(homeKeyStep({ seen: homeKey({ paired: false }), next: k(), homeStatus: 'start' }).reload).toBe(true)
  })
  test('a no-op sync (same rev and wid, new lastSyncedAt) does not reload', () => {
    expect(homeKeyStep({ seen: k(), next: k({ lastSyncedAt: 'b' }), homeStatus: 'start' }).reload).toBe(false)
  })
  test('never while a session is open, loading or failed', () => {
    for (const homeStatus of ['session', 'loading', 'error']) {
      expect(homeKeyStep({ seen: k(), next: k({ copyKey: '5|w5' }), homeStatus }).reload).toBe(false)
    }
  })
  test('no status yet: no reload', () => {
    expect(homeKeyStep({ seen: k(), next: null, homeStatus: 'start' }).reload).toBe(false)
  })
})

describe('homeKeyStep', () => {
  const st = (over = {}) => ({ paired: true, server: 'https://g.example.com', copyKey: '4|w4', ...over })
  const k = over => homeKey(st(over))
  test('a copy that lands while the start screen loads reloads it once the load is done', () => {
    let seen = k()
    let step = homeKeyStep({ seen, next: k({ copyKey: '5|w5' }), homeStatus: 'loading' })
    expect(step).toEqual({ seen: k(), reload: false })
    seen = step.seen
    step = homeKeyStep({ seen, next: k({ copyKey: '5|w5' }), homeStatus: 'start' })
    expect(step).toEqual({ seen: k({ copyKey: '5|w5' }), reload: true })
  })
  test('the first key is recorded once the screen has loaded, with no reload', () => {
    expect(homeKeyStep({ seen: undefined, next: k(), homeStatus: 'loading' })).toEqual({ seen: undefined, reload: false })
    expect(homeKeyStep({ seen: undefined, next: k(), homeStatus: 'start' })).toEqual({ seen: k(), reload: false })
  })
  test('during a session the key moves on without a reload: leaving it reloads anyway', () => {
    expect(homeKeyStep({ seen: k(), next: k({ copyKey: '5|w5' }), homeStatus: 'session' })).toEqual({ seen: k({ copyKey: '5|w5' }), reload: false })
  })
  test('no status yet changes nothing', () => {
    expect(homeKeyStep({ seen: k(), next: null, homeStatus: 'start' })).toEqual({ seen: k(), reload: false })
  })
})

// Unpaired, a routine edit moves no sync key, so a Workout tab already mounted read it only on focus.
describe('reloadsOnFocus', () => {
  test('the start screen and the error screen read again when the tab comes into view', () => {
    expect(reloadsOnFocus('start')).toBe(true)
    expect(reloadsOnFocus('error')).toBe(true)
  })
  test('never while a session is open, and not over a load already running', () => {
    expect(reloadsOnFocus('session')).toBe(false)
    expect(reloadsOnFocus('loading')).toBe(false)
  })
})

// Once the source key is read on focus: the start screen reads again only when it moved since the
// load it shows, so returning to an unchanged tab keeps what it built.
describe('focusReloads', () => {
  const NOW = new Date(2026, 10, 9, 9).getTime()
  const key = (over = {}) => sourceKey({ copyKey: { rev: 7, wid: 'w7' }, workouts: [], weighIns: [], edits: [], now: NOW, ...over })
  test('the start screen keeps what it built while the key holds, and reads again once it moved', () => {
    expect(focusReloads({ homeStatus: 'start', loadedKey: key(), key: key() })).toBe(false)
    expect(focusReloads({ homeStatus: 'start', loadedKey: key(), key: key({ copyKey: { rev: 8, wid: 'w8' } }) })).toBe(true)
    expect(focusReloads({ homeStatus: 'start', loadedKey: key(), key: key({ now: NOW + 24 * 3600000 }) })).toBe(true)
  })
  test('a routine edit saved on the Plan tab moves the key, paired or not, so the start screen reads it', () => {
    expect(focusReloads({ homeStatus: 'start', loadedKey: key(), key: key({ edits: [{ kind: 'routine', key: 'r1', t: 5 }] }) })).toBe(true)
    expect(focusReloads({ homeStatus: 'start', loadedKey: key({ copyKey: null }), key: key({ copyKey: null, edits: [{ kind: 'routine', key: 'r1', t: 5 }] }) })).toBe(true)
  })
  test('a key that could not be read, or no key from the load shown, reads again', () => {
    expect(focusReloads({ homeStatus: 'start', loadedKey: key(), key: null })).toBe(true)
    expect(focusReloads({ homeStatus: 'start', loadedKey: null, key: key() })).toBe(true)
  })
  test('the error screen shows no source, so it reads again whatever the key', () => {
    expect(focusReloads({ homeStatus: 'error', loadedKey: key(), key: key() })).toBe(true)
  })
  test('never while a session is open or a load is running, whatever the key', () => {
    expect(focusReloads({ homeStatus: 'session', loadedKey: key(), key: key({ edits: [{ kind: 'routine', key: 'r1', t: 5 }] }) })).toBe(false)
    expect(focusReloads({ homeStatus: 'loading', loadedKey: null, key: null })).toBe(false)
  })
})

describe('canPair', () => {
  test('needs both fields and no pairing in progress', () => {
    expect(canPair({ address: '', code: 'ABCD2345', busy: false })).toBe(false)
    expect(canPair({ address: 'gym.local', code: '  ', busy: false })).toBe(false)
    expect(canPair({ address: 'gym.local', code: 'ABCD2345', busy: true })).toBe(false)
    expect(canPair({ address: 'gym.local', code: 'ABCD2345', busy: false })).toBe(true)
  })
})

describe('serverLines', () => {
  const base = { paired: true, state: 'idle', pending: 0, server: 'https://gym.example.com:8443/x', profile: 'Mo' }
  test('host without scheme or port, profile, pending count', () => {
    expect(serverLines({ ...base, pending: 1 })).toEqual({ host: 'gym.example.com', profile: 'Mo', pending: '1 workout waiting', weighIns: null, measurements: null, edits: null, canResend: false, lastSynced: true })
    expect(serverLines({ ...base, pending: 3 }).pending).toBe('3 workouts waiting')
    expect(serverLines(base).pending).toBeNull()
  })
  test('weigh-ins waiting are their own line', () => {
    expect(serverLines({ ...base, pendingWeighIns: 1 }).weighIns).toBe('1 weigh-in waiting')
    expect(serverLines({ ...base, pendingWeighIns: 3 }).weighIns).toBe('3 weigh-ins waiting')
    expect(serverLines({ ...base, pendingWeighIns: 0 }).weighIns).toBeNull()
    expect(serverLines({ ...base, pendingWeighIns: 2 }).pending).toBeNull()
  })
  test('measurements waiting are their own line', () => {
    expect(serverLines({ ...base, pendingMeasurements: 1 }).measurements).toBe('1 measurement waiting')
    expect(serverLines({ ...base, pendingMeasurements: 3 }).measurements).toBe('3 measurements waiting')
    expect(serverLines({ ...base, pendingMeasurements: 0 }).measurements).toBeNull()
    expect(serverLines(base).measurements).toBeNull()
    expect(serverLines({ ...base, pendingMeasurements: 2 }).weighIns).toBeNull()
    expect(serverLines({ ...base, pendingWeighIns: 2 }).measurements).toBeNull()
  })
  // Routine, nutrition day and setting edits share one line (spec 7C rule 7; 7D).
  test('plan and nutrition edits waiting are their own line', () => {
    expect(serverLines({ ...base, pendingEdits: 1 }).edits).toBe('1 plan or nutrition edit waiting to send')
    expect(serverLines({ ...base, pendingEdits: 3 }).edits).toBe('3 plan or nutrition edits waiting to send')
    expect(serverLines({ ...base, pendingEdits: 0 }).edits).toBeNull()
    expect(serverLines(base).edits).toBeNull()
    expect(serverLines({ ...base, pendingEdits: 2 }).pending).toBeNull()
  })
  test('send again only for server-older', () => {
    expect(serverLines({ ...base, state: 'problem', problem: 'server-older' }).canResend).toBe(true)
    expect(serverLines({ ...base, state: 'problem', problem: 'conflict' }).canResend).toBe(false)
  })
  test('no profile name gives null', () => {
    expect(serverLines({ ...base, profile: '' }).profile).toBeNull()
  })
  test('no "Last synced" line while the status line already says "Synced to <host> at <time>"', () => {
    const at = '2026-11-09T09:14:00.000Z'
    expect(serverLines({ ...base, lastSyncedAt: at }).lastSynced).toBe(false)
    expect(serverLines({ ...base, state: 'waiting', lastSyncedAt: at }).lastSynced).toBe(false)
    expect(serverLines(base).lastSynced).toBe(true)
    expect(serverLines({ ...base, pending: 1, lastSyncedAt: at }).lastSynced).toBe(true)
    expect(serverLines({ ...base, state: 'syncing', lastSyncedAt: at }).lastSynced).toBe(true)
    expect(serverLines({ ...base, state: 'problem', problem: 'conflict', lastSyncedAt: at }).lastSynced).toBe(true)
  })
})
