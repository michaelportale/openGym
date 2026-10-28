// The palettes in palettes.json and the CSS generated from them (scripts/gen-palettes.mjs).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { outputs, loadPalettes, paletteCss } from '../../scripts/gen-palettes.mjs'
import { isGreenRgb } from '../../scripts/color-audit.mjs'
import { contrast, mix, readableIn } from '../lib/accent.js'
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
  it('uses an explicit light success that is apart from PR gold and readable on white', () => {
    const own = data.palettes.filter(p => p.light?.success)
    expect(own.map(p => p.name)).toContain('ember')
    for (const p of own) {
      const css = paletteCss(p)
      const light = css.slice(css.indexOf(`:root[data-theme="light"][data-palette="${p.name}"] {`))
      const val = k => light.match(new RegExp(`--${k}: (#[0-9a-f]{6})`))[1]
      expect(contrast(val('success'), val('pr'))).toBeGreaterThan(1.5)
      expect(contrast(val('success'), '#ffffff')).toBeGreaterThanOrEqual(4.5)
    }
  })
  it('keeps the personal-record gold apart from success', () => {
    for (const { tokens: t } of data.palettes) expect(t.pr.toLowerCase()).not.toBe(t.success.toLowerCase())
  })
  it('keeps Tide accent text readable on light surfaces', () => {
    const tide = data.palettes.find(p => p.name === 'tide')
    for (const surface of ['#ffffff', '#ececef', '#f2f2f7']) {
      expect(contrast(tide.light.accentText, surface)).toBeGreaterThanOrEqual(4.5)
    }
  })
  it('keeps Tide completed checks readable on their translucent light background', () => {
    const tide = data.palettes.find(p => p.name === 'tide')
    for (const surface of ['#ffffff', '#ececef', '#f2f2f7']) {
      const background = mix(tide.light.success, surface, 0.84)
      expect(contrast(tide.light.success, background)).toBeGreaterThanOrEqual(3)
    }
  })
})

describe('generated palette CSS', () => {
  it('is in sync with palettes.json (run node scripts/gen-palettes.mjs)', () => {
    for (const { file, css } of outputs(data)) expect(readFileSync(file, 'utf8')).toBe(css)
  })
  it('scopes the accent to data-accent="theme" so presets and own colours still win', () => {
    const materials = readFileSync(new URL('./materials.css', import.meta.url), 'utf8')
    for (const { css } of [...outputs(data), { css: materials }]) {
      for (const m of css.matchAll(/^([^\n{]+)\{[^}]*--acc:/gm)) expect(m[1]).toContain('[data-accent="theme"]')
    }
  })
  it('draws status-coloured tiles with a glyph that stands out', () => {
    // Ember's success is chalk: a white glyph on it was 1.30:1. 3:1 is the bar for icons.
    let n = 0
    for (const { css } of outputs(data)) {
      for (const [, body] of css.matchAll(/\{([^}]*)\}/g)) {
        for (const k of ['success', 'warning']) {
          const bg = body.match(new RegExp(`--${k}:\\s*(#[0-9a-f]{6});`, 'i'))
          const ink = body.match(new RegExp(`--on-${k}-tile:\\s*(#[0-9a-f]{6});`, 'i'))
          if (!bg) continue
          expect(ink, `--on-${k}-tile next to --${k}`).toBeTruthy()
          expect(contrast(ink[1], bg[1])).toBeGreaterThanOrEqual(3)
          n++
        }
      }
    }
    expect(n).toBe(data.palettes.length * 4)
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
    expect(DEFAULT_PALETTE).toBe('tide')
    expect(paletteKey({})).toBe('tide')
    expect(paletteKey({ palette: 'chalk' })).toBe('chalk')
    expect(paletteKey({ palette: '"><x' })).toBe('tide')
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

describe('install assets', () => {
  const pub = new URL('../../public/', import.meta.url)
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
  it('give the manifest and the page the default palette background', () => {
    const m = JSON.parse(readFileSync(new URL('manifest.json', pub), 'utf8'))
    const bg = PALETTE_BG[DEFAULT_PALETTE]
    expect(m.theme_color).toBe(bg)
    expect(m.background_color).toBe(bg)
    expect(html).toContain(`<meta name="theme-color" content="${bg}">`)
  })
  it('link an iOS launch image for each listed screen, and each one exists at its size', () => {
    const links = [...html.matchAll(/<link rel="apple-touch-startup-image" href="([^"]+)" media="\(device-width: (\d+)px\) and \(device-height: (\d+)px\) and \(-webkit-device-pixel-ratio: (\d)\)/g)]
    expect(links.length).toBeGreaterThanOrEqual(10)
    for (const [, href, w, h, r] of links) {
      const png = readFileSync(new URL(href, pub))
      // PNG IHDR: width and height, big-endian, at bytes 16 and 20
      expect([png.readUInt32BE(16), png.readUInt32BE(20)], href).toEqual([w * r, h * r])
    }
  })
})
