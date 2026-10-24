// The status-bar scrim: a fixed band the height of the status bar (and connection row) on the page's
// ground, which never takes a tap, under the connection bar so its text stays readable.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { PALETTE_BG, LIGHT_BG } from './palettes.js'
import data from './palettes.json'

const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8')
const rule = sel => { const i = css.indexOf(sel + '{'); return i < 0 ? '' : css.slice(i, css.indexOf('}', i)) }

describe('status-bar scrim', () => {
  const r = rule('body::before')
  it('covers only the status bar and connection row and lets taps through', () => {
    expect(r).toMatch(/position:fixed/)
    expect(r).toMatch(/height:calc\(var\(--sat\) \+ var\(--conn\)\)/)
    expect(r).toMatch(/pointer-events:none/)
    expect(r).toMatch(/color-mix\(in srgb,var\(--bg\) 92%,transparent\)/)
    expect(r).toMatch(/blur\(12px\)/)
  })
  it('sits under the connection bar so its sentence is never veiled', () => {
    const z = s => Number(/z-index:(\d+)/.exec(s)[1])
    expect(z(r)).toBeLessThan(z(rule('.conn-bar')))
  })
  it('theme-color follows each palette ground', () => {
    for (const p of data.palettes) expect(PALETTE_BG[p.name]).toBe(p.tokens.bg0.toLowerCase())
    expect(LIGHT_BG).toBe('#f2f2f7')
  })
})
