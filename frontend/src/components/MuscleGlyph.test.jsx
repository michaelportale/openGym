// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MUSCLES } from '../lib/muscles.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
vi.mock('../store/useStore.js', () => ({ useStore: () => null }))
const { MuscleGlyph, glyphMuscleOf, GLYPH_MUSCLES } = await import('./MuscleGlyph.jsx')
const { Thumb } = await import('./Media.jsx')

const mounted = []
function mount(el) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push({ root, host })
  act(() => root.render(el))
  return host
}
afterEach(() => { act(() => { mounted.splice(0).forEach(({ root, host }) => { root.unmount(); host.remove() }) }) })

describe('muscle glyphs', () => {
  it('has a glyph for every muscle the map shades, plus the full body', () => {
    expect([...GLYPH_MUSCLES].sort()).toEqual([...MUSCLES, 'full'].sort())
  })
  it('keys an exercise by its target, then its group, then its body part, then the full body', () => {
    expect(glyphMuscleOf({ tg: 'chest', mg: 'triceps' })).toBe('chest')
    expect(glyphMuscleOf({ mg: 'biceps' })).toBe('biceps')
    expect(glyphMuscleOf({ bp: 'upper legs' })).not.toBe('full')
    expect(glyphMuscleOf({})).toBe('full')
  })
  it('is decoration: hidden from screen readers and never focusable', () => {
    const svg = mount(<MuscleGlyph muscle="abs" />).querySelector('svg')
    expect(svg.getAttribute('aria-hidden')).toBe('true')
    expect(svg.getAttribute('focusable')).toBe('false')
  })
  it('back-view muscles draw a spine so they read apart from their front-view twins', () => {
    const paths = m => mount(<MuscleGlyph muscle={m} />).querySelectorAll('.mglyph-fig path').length
    expect(paths('triceps')).toBe(paths('biceps') + 1)
    expect(paths('hamstring')).toBe(paths('quadriceps') + 1)
  })
  it('an exercise without a picture shows its muscle glyph, not a dumbbell', () => {
    const host = mount(<Thumb ex={{ id: 'x', tg: 'quadriceps' }} />)
    expect(host.querySelector('.thumb-x svg.mglyph').dataset.muscle).toBe('quadriceps')
  })
})
