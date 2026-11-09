import { describe, expect, test } from 'vitest'
import { FOREGROUND_GAP_MS, canPair, homeKey, serverLines, shouldReloadHome, shouldSyncOnForeground } from './sync-triggers.js'

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

describe('homeKey / shouldReloadHome', () => {
  const st = (over = {}) => ({ paired: true, server: 'https://g.example.com', copyKey: '4|w4', lastSyncedAt: 'a', ...over })
  const k = over => homeKey(st(over))
  test('the first status only records the key', () => {
    expect(shouldReloadHome({ prev: undefined, next: k(), homeStatus: 'start' })).toBe(false)
  })
  test('a new server copy, pairing or forgetting reloads the start screen', () => {
    expect(shouldReloadHome({ prev: k(), next: k({ copyKey: '5|w5' }), homeStatus: 'start' })).toBe(true)
    expect(shouldReloadHome({ prev: k(), next: homeKey({ paired: false }), homeStatus: 'start' })).toBe(true)
    expect(shouldReloadHome({ prev: homeKey({ paired: false }), next: k(), homeStatus: 'start' })).toBe(true)
  })
  test('a no-op sync (same rev and wid, new lastSyncedAt) does not reload', () => {
    expect(shouldReloadHome({ prev: k(), next: k({ lastSyncedAt: 'b' }), homeStatus: 'start' })).toBe(false)
  })
  test('never while a session is open, loading or failed', () => {
    for (const homeStatus of ['session', 'loading', 'error']) {
      expect(shouldReloadHome({ prev: k(), next: k({ copyKey: '5|w5' }), homeStatus })).toBe(false)
    }
  })
  test('no status yet: no reload', () => {
    expect(shouldReloadHome({ prev: k(), next: null, homeStatus: 'start' })).toBe(false)
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
    expect(serverLines({ ...base, pending: 1 })).toEqual({ host: 'gym.example.com', profile: 'Mo', pending: '1 workout waiting', canResend: false, lastSynced: true })
    expect(serverLines({ ...base, pending: 3 }).pending).toBe('3 workouts waiting')
    expect(serverLines(base).pending).toBeNull()
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
