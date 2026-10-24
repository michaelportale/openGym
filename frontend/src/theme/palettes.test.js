// The palettes in palettes.json and the CSS generated from them (scripts/gen-palettes.mjs).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { outputs, loadPalettes } from '../../scripts/gen-palettes.mjs'
import { isGreenRgb } from '../../scripts/color-audit.mjs'
import { contrast, readableIn } from '../lib/accent.js'
import { CLASSIC, DEFAULT_PALETTE, PALETTES, PALETTE_NAMES, PALETTE_BG, paletteKey, themeAttr, darkAttrOf } from './palettes.js'

const data = loadPalettes()
const rgb = h => { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255] }

describe('palettes.json', () => {
  it('marks exactly one default, and the top-level default names it', () => {
    const marked = data.palettes.filter(p => p.default).map(p => p.name)
    expect(marked).toEqual([data.default])
  })
  it('gives every palette the full token set as #rrggbb', () => {
    const keys = Object.keys(data.palettes[0].tokens).sort()
    for (const p of data.palettes) {
      expect(Object.keys(p.tokens).sort()).toEqual(keys)
      for (const v of Object.values(p.tokens)) expect(v).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })
  it('keeps text on the accent readable (black on the default accent: 7.41:1)', () => {
    for (const { tokens: t } of data.palettes) {
      expect(contrast(t.onAccent, t.accent)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(t.onAccent, t.accentPressed)).toBeGreaterThanOrEqual(3)
    }
    const ember = data.palettes.find(p => p.name === 'ember').tokens
    expect(contrast(ember.onAccent, ember.accent)).toBeCloseTo(7.41, 1)
  })
  it('keeps body text readable on cards', () => {
    for (const { tokens: t } of data.palettes) {
      expect(contrast(t.text1, t.surface)).toBeGreaterThanOrEqual(7)
      expect(contrast(t.text2, t.surface)).toBeGreaterThanOrEqual(4.5)
    }
  })
  it('never makes success green, in dark or light', () => {
    for (const { tokens: t } of data.palettes) {
      expect(isGreenRgb(rgb(t.success))).toBe(false)
      expect(isGreenRgb(rgb(readableIn(t.success, 'light')))).toBe(false)
    }
  })
  it('keeps the personal-record gold apart from success', () => {
    for (const { tokens: t } of data.palettes) expect(t.pr.toLowerCase()).not.toBe(t.success.toLowerCase())
  })
})

describe('generated palette CSS', () => {
  it('is in sync with palettes.json (run node scripts/gen-palettes.mjs)', () => {
    for (const { file, css } of outputs(data)) expect(readFileSync(file, 'utf8')).toBe(css)
  })
  it('scopes the accent to data-accent="theme" so presets and own colours still win', () => {
    for (const { css } of outputs(data)) {
      for (const m of css.matchAll(/^([^\n{]+)\{[^}]*--acc:/gm)) expect(m[1]).toContain('[data-accent="theme"]')
    }
  })
})

describe('switching palettes on <html>', () => {
  it('names the palette in dark mode, light in light mode, and dark for Classic', () => {
    expect(themeAttr('dark', 'ember')).toBe('ember')
    expect(themeAttr('dark', 'volt')).toBe('volt')
    expect(themeAttr('light', 'ember')).toBe('light')
    expect(themeAttr('dark', CLASSIC)).toBe('dark')
    expect(themeAttr('dark', 'nope')).toBe('dark')
  })
  it('defaults to the palette named in palettes.json', () => {
    expect(DEFAULT_PALETTE).toBe('ember')
    expect(paletteKey({})).toBe('ember')
    expect(paletteKey({ palette: 'chalk' })).toBe('chalk')
    expect(paletteKey({ palette: '"><x' })).toBe('ember')
    expect(paletteKey({ palette: CLASSIC })).toBe(CLASSIC)
  })
  it('lists every palette in Settings, with Classic last', () => {
    expect(PALETTES).toEqual([...data.palettes.map(p => p.name), CLASSIC])
    for (const p of PALETTES) expect(PALETTE_NAMES[p]).toBeTruthy()
    for (const p of PALETTES) expect(PALETTE_BG[p]).toMatch(/^#[0-9a-f]{6}$/)
  })
  it('reads the dark value back from data-palette (the timer flash)', () => {
    expect(darkAttrOf({ dataset: { palette: 'volt' } })).toBe('volt')
    expect(darkAttrOf({ dataset: {} })).toBe('dark')
  })
})
