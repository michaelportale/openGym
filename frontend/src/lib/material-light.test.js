// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installMaterialLight } from './material-light.js'

let cleanup
afterEach(() => { cleanup?.(); document.body.innerHTML = ''; vi.unstubAllGlobals() })

function setup(matches = true) {
  const media = new EventTarget()
  media.matches = matches
  vi.stubGlobal('matchMedia', () => media)
  let callback
  vi.stubGlobal('requestAnimationFrame', vi.fn(fn => { callback = fn; return 1 }))
  vi.stubGlobal('cancelAnimationFrame', vi.fn(() => { callback = null }))
  document.body.innerHTML = '<div class="today-card"><button>Start</button></div>'
  const card = document.querySelector('.today-card')
  card.getBoundingClientRect = () => ({ left: 10, top: 20 })
  cleanup = installMaterialLight()
  return { card, media, flush: () => callback?.() }
}
const move = (card, pointerType = 'mouse') => card.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType, clientX: 40, clientY: 60 }))

describe('material light', () => {
  it('coalesces pointer events and positions the reflection relative to its card', () => {
    const { card, flush } = setup()
    move(card); move(card); flush()
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1)
    expect(card.style.getPropertyValue('--shine-x')).toBe('30px')
    expect(card.style.getPropertyValue('--shine-y')).toBe('40px')
    expect(card.classList.contains('material-lit')).toBe(true)
  })
  it('does not schedule work for touch or reduced motion', () => {
    const { card, media } = setup()
    move(card, 'touch')
    media.matches = false
    move(card)
    expect(requestAnimationFrame).not.toHaveBeenCalled()
  })
  it('removes reflections and pending work when the preference changes or on cleanup', () => {
    const { card, media, flush } = setup()
    move(card); flush()
    media.dispatchEvent(new Event('change'))
    expect(card.classList.contains('material-lit')).toBe(false)
    expect(card.style.getPropertyValue('--shine-x')).toBe('')
    move(card); cleanup(); flush()
    expect(card.classList.contains('material-lit')).toBe(false)
    expect(cancelAnimationFrame).toHaveBeenCalled()
  })
})
