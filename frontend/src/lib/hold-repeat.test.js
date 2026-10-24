// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { holdRepeat, cancelHold, HOLD_DELAY, HOLD_EVERY } from './hold-repeat.js'

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
  it('a lift anywhere on the page ends the hold', () => {
    const step = vi.fn(); const h = holdRepeat(step)
    h.onPointerDown({ button: 0 }); vi.advanceTimersByTime(HOLD_DELAY + HOLD_EVERY)
    document.body.dispatchEvent(new Event('pointerup', { bubbles: true }))
    vi.advanceTimersByTime(1000)
    expect(step).toHaveBeenCalledTimes(2)
  })
  it('a cancelled pointer anywhere ends the hold too', () => {
    const step = vi.fn(); const h = holdRepeat(step)
    h.onPointerDown({ button: 0 }); vi.advanceTimersByTime(HOLD_DELAY)
    document.dispatchEvent(new Event('pointercancel'))
    vi.advanceTimersByTime(1000)
    expect(step).toHaveBeenCalledTimes(1)
  })
  it('the view leaving stops its own hold, and only its own', () => {
    const mine = {}, other = {}
    const step = vi.fn(); const h = holdRepeat(step, mine)
    h.onPointerDown({ button: 0 }); vi.advanceTimersByTime(HOLD_DELAY)
    cancelHold(other); vi.advanceTimersByTime(HOLD_EVERY)
    expect(step).toHaveBeenCalledTimes(2)
    cancelHold(mine); vi.advanceTimersByTime(1000)
    expect(step).toHaveBeenCalledTimes(2)
  })
  it('after sliding off a hold, the next tap on the button still steps', () => {
    const step = vi.fn(); const h = holdRepeat(step)
    h.onPointerDown({ button: 0 }); vi.advanceTimersByTime(HOLD_DELAY)
    h.onPointerLeave()
    expect(step).toHaveBeenCalledTimes(1)
    h.onClick()
    expect(step).toHaveBeenCalledTimes(2)
  })
})
