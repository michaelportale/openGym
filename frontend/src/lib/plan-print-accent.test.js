import { describe, expect, it } from 'vitest'
import { planPrintHTML, printAccent } from './plan-share.js'
import { contrast } from './accent.js'
import { PALETTES } from '../theme/palettes.js'

const S = palette => ({ palette, unit: 'kg', routines: [{ id: 'r1', name: 'Push', ex: [] }], schedule: {}, workouts: [] })

describe('the printed plan takes its accent from the palette', () => {
  it('reads at 5.3:1 on white for every palette', () => {
    for (const p of PALETTES) expect(contrast(printAccent(S(p)).ink, '#ffffff')).toBeGreaterThanOrEqual(5.3)
  })
  it('draws the superset rule from the ink, visible on white for every palette', () => {
    for (const p of PALETTES) {
      const { ink, rule } = printAccent(S(p))
      expect(rule).not.toBe(ink)
      expect(contrast(rule, '#ffffff')).toBeGreaterThanOrEqual(3)
    }
    expect(printAccent(S('chalk')).rule.toLowerCase()).not.toBe('#fdfdfd')
  })
  it('writes no fixed accent colour into the page', () => {
    const html = planPrintHTML(S('volt'), null, {})
    expect(html).not.toContain('#b34b25')
    expect(html).not.toContain('#ffbca4')
    expect(html).toContain(printAccent(S('volt')).ink)
    expect(printAccent(S('volt')).ink).not.toBe(printAccent(S('ember')).ink)
  })
})
