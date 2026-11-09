import { expect, test, vi } from 'vitest'
import { afterPaint } from './after-paint.js'

test('runs on the idle callback, with a timeout so a busy thread still gets there', () => {
  const host = { requestIdleCallback: vi.fn(() => 7), cancelIdleCallback: vi.fn() }
  const fn = vi.fn()
  const cancel = afterPaint(fn, host)
  expect(fn).not.toHaveBeenCalled()
  const [cb, options] = host.requestIdleCallback.mock.calls[0]
  expect(options.timeout).toBeGreaterThan(0)
  cb({ didTimeout: false })
  expect(fn).toHaveBeenCalledTimes(1)
  cancel()
  expect(host.cancelIdleCallback).toHaveBeenCalledWith(7)
})

test('falls back to a zero timeout where there is no idle callback, and cancels it', () => {
  vi.useFakeTimers()
  try {
    const fn = vi.fn()
    afterPaint(fn, globalThis.requestIdleCallback ? { setTimeout, clearTimeout } : globalThis)
    expect(fn).not.toHaveBeenCalled()
    vi.runAllTimers()
    expect(fn).toHaveBeenCalledTimes(1)
    const later = vi.fn()
    const cancel = afterPaint(later, { setTimeout, clearTimeout })
    cancel()
    vi.runAllTimers()
    expect(later).not.toHaveBeenCalled()
  } finally {
    vi.useRealTimers()
  }
})
