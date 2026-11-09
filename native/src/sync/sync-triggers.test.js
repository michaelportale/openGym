import { describe, expect, test } from 'vitest'
import { FOREGROUND_GAP_MS, canPair, homeKey, homeKeyStep, reloadsOnFocus, serverLines, shouldSyncOnForeground } from './sync-triggers.js'

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
    expect(serverLines({ ...base, pending: 1 })).toEqual({ host: 'gym.example.com', profile: 'Mo', pending: '1 workout waiting', weighIns: null, routineEdits: null, canResend: false, lastSynced: true })
    expect(serverLines({ ...base, pending: 3 }).pending).toBe('3 workouts waiting')
    expect(serverLines(base).pending).toBeNull()
  })
  test('weigh-ins waiting are their own line', () => {
    expect(serverLines({ ...base, pendingWeighIns: 1 }).weighIns).toBe('1 weigh-in waiting')
    expect(serverLines({ ...base, pendingWeighIns: 3 }).weighIns).toBe('3 weigh-ins waiting')
    expect(serverLines({ ...base, pendingWeighIns: 0 }).weighIns).toBeNull()
    expect(serverLines({ ...base, pendingWeighIns: 2 }).pending).toBeNull()
  })
  test('routine edits waiting are their own line (spec 7C rule 7)', () => {
    expect(serverLines({ ...base, pendingRoutineEdits: 1 }).routineEdits).toBe('1 routine edit waiting')
    expect(serverLines({ ...base, pendingRoutineEdits: 3 }).routineEdits).toBe('3 routine edits waiting')
    expect(serverLines({ ...base, pendingRoutineEdits: 0 }).routineEdits).toBeNull()
    expect(serverLines(base).routineEdits).toBeNull()
    expect(serverLines({ ...base, pendingRoutineEdits: 2 }).pending).toBeNull()
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
