// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { vibrate, setVibrate } from './sound.js'

const setNav = (ua, vibrate, touch = 5) => {
  vi.stubGlobal('navigator', { userAgent: ua, maxTouchPoints: touch, ...(vibrate ? { vibrate } : {}) })
}
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15'
const DESKTOP = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36'

afterEach(() => {
  vi.unstubAllGlobals(); setVibrate(true)
  document.querySelectorAll('.haptic-switch').forEach(n => n.remove())
})

describe('a tap buzz on set complete', () => {
  it('buzzes through navigator.vibrate where it exists, as before', () => {
    const v = vi.fn(); setNav(DESKTOP, v, 0)
    vibrate(30)
    expect(v).toHaveBeenCalledWith(30)
    expect(document.querySelector('.haptic-switch')).toBeNull()
  })
  it('on iOS toggles one hidden switch through its label, and keeps the click to itself', () => {
    setNav(IPHONE)
    const outside = vi.fn(); document.addEventListener('click', outside)
    vibrate(30); vibrate(8)
    document.removeEventListener('click', outside)
    const labels = document.querySelectorAll('.haptic-switch')
    expect(labels.length).toBe(1)
    const input = labels[0].querySelector('input')
    expect(input.type).toBe('checkbox')
    expect(input.hasAttribute('switch')).toBe(true)
    expect(input.tabIndex).toBe(-1)
    expect(labels[0].getAttribute('aria-hidden')).toBe('true')
    expect(outside).not.toHaveBeenCalled()
  })
  it('has no stand-in for a pattern or a long buzz, on a desktop, or with Vibrate turned off', () => {
    setNav(IPHONE)
    vibrate([200, 100, 200]); vibrate(400)
    expect(document.querySelector('.haptic-switch')).toBeNull()
    setNav(DESKTOP, null, 0)
    vibrate(30)
    setNav(IPHONE); setVibrate(false)
    vibrate(30)
    expect(document.querySelector('.haptic-switch')).toBeNull()
  })
  it('Vibrate off stops the iPhone switch tap, and on brings it back', () => {
    setNav(IPHONE)
    vibrate(30)
    const input = document.querySelector('.haptic-switch input')
    const toggles = vi.fn(); input.addEventListener('change', toggles)
    const was = input.checked
    setVibrate(false)
    vibrate(30); vibrate(8)
    expect(toggles).not.toHaveBeenCalled()
    expect(input.checked).toBe(was)
    setVibrate(true)
    vibrate(30)
    expect(toggles).toHaveBeenCalledTimes(1)
    expect(input.checked).toBe(!was)
  })
})
