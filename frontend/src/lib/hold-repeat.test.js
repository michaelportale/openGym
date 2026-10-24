import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { holdRepeat, HOLD_DELAY, HOLD_EVERY } from './hold-repeat.js'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('hold to repeat', () => {
  it('a tap steps once', () => {
    const step = vi.fn(); const h = holdRepeat(step)
    h.onPointerDown({ button: 0 }); h.onPointerUp(); h.onClick()
    expect(step).toHaveBeenCalledTimes(1)
  })
  it('a keyboard click steps once', () => {
    const step = vi.fn(); holdRepeat(step).onClick()
    expect(step).toHaveBeenCalledTimes(1)
  })
  it('a hold steps after 400 ms, then eight times a second, and its closing click adds nothing', () => {
    const step = vi.fn(); const h = holdRepeat(step)
    h.onPointerDown({ button: 0 })
    vi.advanceTimersByTime(HOLD_DELAY - 1)
    expect(step).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(step).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(HOLD_EVERY * 8)
    expect(step).toHaveBeenCalledTimes(9)
    // the row re-rendered: a new handler set sees the lift
    const later = holdRepeat(step)
    later.onPointerUp(); later.onClick()
    vi.advanceTimersByTime(1000)
    expect(step).toHaveBeenCalledTimes(9)
  })
  it('leaving the button stops the hold', () => {
    const step = vi.fn(); const h = holdRepeat(step)
    h.onPointerDown({ button: 0 }); vi.advanceTimersByTime(HOLD_DELAY + HOLD_EVERY)
    h.onPointerLeave(); vi.advanceTimersByTime(1000)
    expect(step).toHaveBeenCalledTimes(2)
  })
})
