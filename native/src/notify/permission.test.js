import { describe, expect, test, vi } from 'vitest'
import { REQUEST_OPTIONS, permissionStep, readStep, restBegan, shouldExplainAlertsOff, stepForRestStart } from './permission.js'

const NOW = Date.parse('2026-11-07T15:00:00.000Z')
const perm = (status, iosStatus, granted = false) => ({ status, granted, canAskAgain: true, ios: iosStatus == null ? undefined : { status: iosStatus } })

describe('permissionStep', () => {
  test('granted, authorized, provisional and ephemeral are granted', () => {
    expect(permissionStep(perm('granted', 2, true))).toBe('granted')
    expect(permissionStep(perm('granted', undefined, true))).toBe('granted')
    expect(permissionStep(perm('undetermined', 3))).toBe('granted')
    expect(permissionStep(perm('undetermined', 4))).toBe('granted')
  })

  test('undetermined with iOS not determined, or no iOS status, is ask', () => {
    expect(permissionStep(perm('undetermined', 0))).toBe('ask')
    expect(permissionStep(perm('undetermined'))).toBe('ask')
  })

  test('denied and anything unknown is off', () => {
    expect(permissionStep(perm('denied', 1))).toBe('off')
    expect(permissionStep(perm('denied'))).toBe('off')
    expect(permissionStep(perm('undetermined', 1))).toBe('off')
    expect(permissionStep(null)).toBe('off')
    expect(permissionStep({})).toBe('off')
  })
})

describe('readStep', () => {
  test('a read that rejects is off', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await readStep(async () => { throw new Error('boom') })).toBe('off')
    warn.mockRestore()
  })
})

describe('stepForRestStart', () => {
  const requested = []
  const request = answer => async options => { requested.push(options); return answer }

  test('asks once, with the alert and sound options, while the step is ask', async () => {
    requested.length = 0
    const out = await stepForRestStart({ read: async () => perm('undetermined', 0), request: request(perm('granted', 2, true)), mayAsk: true })
    expect(out).toEqual({ step: 'granted', asked: true })
    expect(requested).toEqual([{ ios: { allowAlert: true, allowSound: true, allowBadge: false } }])
    expect(requested[0]).toBe(REQUEST_OPTIONS)
  })

  test('an answer of no is off, and asked', async () => {
    const out = await stepForRestStart({ read: async () => perm('undetermined', 0), request: request(perm('denied', 1)), mayAsk: true })
    expect(out).toEqual({ step: 'off', asked: true })
  })

  test('does not ask again once asked, and never asks when granted or off', async () => {
    requested.length = 0
    expect(await stepForRestStart({ read: async () => perm('undetermined', 0), request: request(perm('granted', 2, true)), mayAsk: false })).toEqual({ step: 'ask', asked: false })
    expect(await stepForRestStart({ read: async () => perm('granted', 2, true), request: request(null), mayAsk: true })).toEqual({ step: 'granted', asked: false })
    expect(await stepForRestStart({ read: async () => perm('denied', 1), request: request(null), mayAsk: true })).toEqual({ step: 'off', asked: false })
    expect(requested).toEqual([])
  })

  test('a request that rejects is off', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const out = await stepForRestStart({ read: async () => perm('undetermined', 0), request: async () => { throw new Error('boom') }, mayAsk: true })
    expect(out).toEqual({ step: 'off', asked: true })
    warn.mockRestore()
  })
})

describe('shouldExplainAlertsOff', () => {
  test('once for each session id', () => {
    const told = new Set()
    expect(shouldExplainAlertsOff('s1', told)).toBe(true)
    told.add('s1')
    expect(shouldExplainAlertsOff('s1', told)).toBe(false)
    expect(shouldExplainAlertsOff('s2', told)).toBe(true)
  })

  test('no session id, nothing to explain', () => {
    expect(shouldExplainAlertsOff(null, new Set())).toBe(false)
  })
})

describe('restBegan', () => {
  const running = deadline => ({ status: 'running', deadline, totalMs: 90_000, remainingMs: 90_000 })

  test('a new running rest began', () => {
    expect(restBegan(null, running(NOW + 90_000), NOW)).toBe(true)
    expect(restBegan(running(NOW + 5_000), running(NOW + 90_000), NOW)).toBe(true)
    expect(restBegan({ status: 'paused', deadline: NOW + 5_000, remainingMs: 5000, totalMs: 90_000 }, running(NOW + 90_000), NOW)).toBe(true)
  })

  test('the same rest, none, or one already over is not a start', () => {
    expect(restBegan(running(NOW + 90_000), running(NOW + 90_000), NOW)).toBe(false)
    expect(restBegan(null, null, NOW)).toBe(false)
    expect(restBegan(running(NOW + 90_000), null, NOW)).toBe(false)
    expect(restBegan(null, running(NOW - 1), NOW)).toBe(false)
  })
})
