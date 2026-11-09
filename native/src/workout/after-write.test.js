import { describe, expect, test, vi } from 'vitest'
import { ALERTS_OFF_NOTICE } from '../notify/permission.js'
import { afterGatedWrite, alertsOffNotice } from './after-write.js'

describe('alertsOffNotice', () => {
  const marked = extra => ({ ok: true, saved: true, alertsOff: true, ...extra })

  test('shows for a clean write that started a rest, and marks the session told', () => {
    const told = new Set()
    expect(alertsOffNotice(marked(), 'complete', 's1', told)).toBe(ALERTS_OFF_NOTICE)
    expect(told.has('s1')).toBe(true)
  })

  test('at most once for each session id', () => {
    const told = new Set()
    expect(alertsOffNotice(marked(), 'complete', 's1', told)).toBe(ALERTS_OFF_NOTICE)
    expect(alertsOffNotice(marked(), 'complete', 's1', told)).toBeNull()
    expect(alertsOffNotice(marked(), 'complete', 's2', told)).toBe(ALERTS_OFF_NOTICE)
  })

  test.each([
    ['a failure', { ok: false, saved: false, error: { code: 'storage' } }],
    ['a warning', { checkpointError: new Error('x') }],
    ['saved, rest did not start', { restFailed: true }],
  ])('never replaces %s, and is not marked told', (_n, extra) => {
    const told = new Set()
    expect(alertsOffNotice(marked(extra), 'complete', 's1', told)).toBeNull()
    expect(told.size).toBe(0)
    // Shown later, once nothing else is said.
    expect(alertsOffNotice(marked(), 'complete', 's1', told)).toBe(ALERTS_OFF_NOTICE)
  })

  test('only a result marked alertsOff, with a session id', () => {
    const told = new Set()
    expect(alertsOffNotice({ ok: true, saved: true }, 'complete', 's1', told)).toBeNull()
    expect(alertsOffNotice(null, 'complete', 's1', told)).toBeNull()
    expect(alertsOffNotice(marked(), 'complete', null, told)).toBeNull()
    expect(told.size).toBe(0)
  })
})

const NOW = Date.parse('2026-11-07T15:00:00.000Z')
const running = deadline => ({ status: 'running', deadline, totalMs: 90_000, remainingMs: 90_000 })
const quiet = () => vi.spyOn(console, 'warn').mockImplementation(() => {})

describe('afterGatedWrite', () => {
  test('runs afterWrite for a written result and returns the result as it was', async () => {
    const afterWrite = vi.fn(async () => null)
    const result = { ok: true, saved: true }
    expect(await afterGatedWrite(result, { afterWrite, before: null, after: () => null, now: NOW })).toBe(result)
    expect(afterWrite).toHaveBeenCalledTimes(1)
    expect(afterWrite).toHaveBeenCalledWith({ restStarted: false })
  })

  test('a null result (nothing to write) still reconciles', async () => {
    const afterWrite = vi.fn(async () => null)
    expect(await afterGatedWrite(null, { afterWrite, before: null, after: () => null, now: NOW })).toBeNull()
    expect(afterWrite).toHaveBeenCalledTimes(1)
  })

  test('a dropped tap writes nothing and runs nothing', async () => {
    const afterWrite = vi.fn()
    const result = { ignored: true }
    expect(await afterGatedWrite(result, { afterWrite, before: null, after: () => running(NOW + 1), now: NOW })).toBe(result)
    expect(afterWrite).not.toHaveBeenCalled()
  })

  test('no afterWrite is fine', async () => {
    const result = { ok: true }
    expect(await afterGatedWrite(result, { before: null, after: () => null, now: NOW })).toBe(result)
  })

  test('an afterWrite that throws or rejects never reaches the write', async () => {
    const warn = quiet()
    const result = { ok: true, saved: true }
    expect(await afterGatedWrite(result, { afterWrite: () => { throw new Error('sync') }, before: null, after: () => null, now: NOW })).toBe(result)
    expect(await afterGatedWrite(result, { afterWrite: async () => { throw new Error('async') }, before: null, after: () => null, now: NOW })).toBe(result)
    expect(await afterGatedWrite(result, { afterWrite: async () => { throw new Error('async start') }, before: null, after: () => running(NOW + 90_000), now: NOW })).toBe(result)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(warn).toHaveBeenCalledTimes(3)
    warn.mockRestore()
  })

  test('a started rest tells afterWrite, and an off answer marks the result', async () => {
    const afterWrite = vi.fn(async () => ({ step: 'off', asked: false }))
    const result = { ok: true, saved: true }
    const out = await afterGatedWrite(result, { afterWrite, before: null, after: () => running(NOW + 90_000), now: NOW })
    expect(afterWrite).toHaveBeenCalledWith({ restStarted: true })
    expect(out).toEqual({ ok: true, saved: true, alertsOff: true })
    expect(result).toEqual({ ok: true, saved: true })
  })

  test('granted, or just asked, or no rest started: no mark', async () => {
    const after = () => running(NOW + 90_000)
    for (const answer of [{ step: 'granted', asked: false }, { step: 'off', asked: true }, null]) {
      const out = await afterGatedWrite({ ok: true }, { afterWrite: async () => answer, before: null, after, now: NOW })
      expect(out.alertsOff).toBeUndefined()
    }
    const same = running(NOW + 90_000)
    const out = await afterGatedWrite({ ok: true }, { afterWrite: async () => ({ step: 'off', asked: false }), before: same, after: () => same, now: NOW })
    expect(out.alertsOff).toBeUndefined()
  })

  test('a write that failed is never marked, whatever the permission says', async () => {
    const failed = { ok: false, saved: false, error: { code: 'storage' } }
    const out = await afterGatedWrite(failed, { afterWrite: async () => ({ step: 'off', asked: false }), before: null, after: () => running(NOW + 90_000), now: NOW })
    expect(out).toBe(failed)
  })
})
