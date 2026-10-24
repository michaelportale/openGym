import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const tokens = readFileSync('src/theme/tokens.css', 'utf8')
const css = readFileSync('src/index.css', 'utf8')

describe('number type', () => {
  it('adds the two display steps to the type scale', () => {
    expect(tokens).toMatch(/--fs-display:\s*36px/)
    expect(tokens).toMatch(/--fs-hero:\s*80px/)
  })
  it('draws .tnum in the rounded numerals with fixed-width digits, bold', () => {
    const rule = css.match(/\n\.tnum\{([^}]*)\}/)[1]
    expect(rule).toContain('font-family:var(--font-num)')
    expect(rule).toContain('font-variant-numeric:tabular-nums')
    expect(rule).toContain('font-weight:700')
  })
  it('sets a unit at half size, secondary and medium', () => {
    const rule = css.match(/\.tnum \.unit\{([^}]*)\}/)[1]
    expect(rule).toContain('font-size:.5em')
    expect(rule).toContain('color:var(--label-2)')
    expect(rule).toContain('font-weight:500')
  })
})
