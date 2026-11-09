import { describe, expect, test } from 'vitest'
import { hostOf, statusText } from './sync-status.js'

const NOW = Date.parse('2026-11-09T18:30:00.000Z')
const AT = '2026-11-09T09:14:00.000Z'
// Fixed formatters, so nothing depends on the machine's time zone or locale.
const formatTime = ms => new Date(ms).toISOString().slice(11, 16).replace(/^0/, '')
const formatDay = ms => new Date(ms).toISOString().slice(0, 10)
const opts = { now: NOW, formatTime, formatDay }
const paired = over => ({ paired: true, state: 'idle', pending: 0, server: 'https://gym.example.com', profile: 'Mo', ...over })

describe('hostOf', () => {
  test.each([
    ['https://gym.example.com', 'gym.example.com'],
    ['http://192.168.1.20:3000', '192.168.1.20'],
    ['http://mac-mini.local:8080', 'mac-mini.local'],
    ['http://[fd00::1]:3000', 'fd00::1'],
    ['https://gym.example.com/', 'gym.example.com'],
  ])('%s -> %s', (base, host) => {
    expect(hostOf(base)).toBe(host)
  })
  test('nothing gives an empty string', () => {
    expect(hostOf(undefined)).toBe('')
    expect(hostOf('')).toBe('')
  })
})

describe('statusText', () => {
  test('synced today: the host and the time', () => {
    expect(statusText(paired({ lastSyncedAt: AT }), opts)).toBe('Synced to gym.example.com at 9:14')
  })

  test('synced on an earlier day: the day too', () => {
    expect(statusText(paired({ lastSyncedAt: '2026-11-07T21:05:00.000Z' }), opts))
      .toBe('Synced to gym.example.com on 2026-11-07 at 21:05')
  })

  test('waiting, or idle with workouts still to send', () => {
    const words = 'Saved on this phone. It will sync when gym.example.com is reachable.'
    expect(statusText(paired({ state: 'waiting', pending: 1, lastSyncedAt: AT }), opts)).toBe(words)
    expect(statusText(paired({ state: 'waiting', pending: 0 }), opts)).toBe(words)
    expect(statusText(paired({ state: 'idle', pending: 2, lastSyncedAt: AT }), opts)).toBe(words)
  })

  test('paired but never synced, with nothing to send', () => {
    expect(statusText(paired({}), opts)).toBe('Paired with gym.example.com. Not synced yet.')
  })

  test('syncing', () => {
    expect(statusText(paired({ state: 'syncing' }), opts)).toBe('Syncing with gym.example.com…')
  })

  test('not paired', () => {
    expect(statusText({ paired: false, state: 'unpaired', pending: 3 }, opts)).toBe('Not paired. Saved on this phone.')
  })

  test('signed out by the server', () => {
    expect(statusText({ paired: false, state: 'unpaired', problem: 'unpaired', pending: 1, server: 'https://gym.example.com' }, opts))
      .toBe('gym.example.com signed this phone out. Saved on this phone; pair again to sync.')
  })

  test.each([
    ['server-older', 'gym.example.com has older data than this phone last saw, as if restored from a backup. Nothing was sent. Your workouts are safe on this phone; send them again to put them back.'],
    ['conflict', 'gym.example.com kept changing while this phone synced. Your workouts are safe on this phone; it will try again.'],
    ['too-large', 'Your server refused the upload because it is too large. Your workouts stay on this phone. If a proxy sits in front of the server, raise its upload limit to at least 5 MB (see the self-hosting guide).'],
    ['error', 'Saved on this phone. Syncing stopped on an error here; it will try again.'],
    ['something-new', 'Saved on this phone. Syncing stopped on a problem; it will try again.'],
  ])('problem %s has its own sentence', (problem, words) => {
    expect(statusText(paired({ state: 'problem', problem, pending: 1 }), opts)).toBe(words)
  })

  test('a refusal names the HTTP status', () => {
    expect(statusText(paired({ state: 'problem', problem: 'refused', httpStatus: 403, pending: 1 }), opts))
      .toBe("Your server refused this phone's workouts (error 403). Nothing was overwritten. They stay on this phone.")
    expect(statusText(paired({ state: 'problem', problem: 'refused', pending: 1 }), opts))
      .toBe("Your server refused this phone's workouts. Nothing was overwritten. They stay on this phone.")
  })

  test('never shows the full address', () => {
    const server = 'http://192.168.1.20:3000'
    const states = [
      paired({ server, lastSyncedAt: AT }),
      paired({ server, state: 'waiting' }),
      paired({ server, state: 'syncing' }),
      paired({ server }),
      ...['server-older', 'conflict'].map(problem => paired({ server, state: 'problem', problem })),
      { paired: false, state: 'unpaired', problem: 'unpaired', pending: 0, server },
    ]
    for (const s of states) {
      const text = statusText(s, opts)
      expect(text).toContain('192.168.1.20')
      expect(text).not.toMatch(/http|:3000/)
    }
  })

  test('the server can be passed in place of the one in the status', () => {
    expect(statusText(paired({ server: undefined, state: 'waiting' }), { ...opts, server: 'https://other.example.org' }))
      .toBe('Saved on this phone. It will sync when other.example.org is reachable.')
  })

  test('the default time is the device locale form of h:mm', () => {
    const text = statusText(paired({ lastSyncedAt: AT }), { now: Date.parse(AT) })
    expect(text).toMatch(/^Synced to gym\.example\.com at .*\d{1,2}[:.]\d{2}/)
    expect(text).not.toMatch(/ on /)
  })
})
