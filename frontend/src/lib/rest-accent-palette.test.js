// @vitest-environment happy-dom
import { describe, expect, it, afterEach } from 'vitest'
import { accentColors } from './rest-alert.js'

describe('rest countdown colour after a palette change', () => {
  afterEach(() => { delete document.documentElement.dataset.palette })
  it('uses the palette it is given, not the one still on the page', () => {
    document.documentElement.dataset.palette = 'ember'
    const now = accentColors('theme', 'volt')
    expect(now).toEqual(accentColors('theme', 'volt'))
    expect(now.accent).not.toBe(accentColors('theme').accent)
    document.documentElement.dataset.palette = 'volt'
    expect(now).toEqual(accentColors('theme'))
  })
  it('falls back to the page palette when none is given', () => {
    document.documentElement.dataset.palette = 'chalk'
    expect(accentColors('theme')).toEqual(accentColors('theme', 'chalk'))
  })
})
