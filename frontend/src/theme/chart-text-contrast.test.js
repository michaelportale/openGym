import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

// Chart axis values and dates are text, so they need 4.5:1 against the card they are drawn on.
// .lc-text mixes the label colour into the surface; this recomputes the result for every theme
// block that sets a label or surface colour, falling back to the base light or dark values.
const src = f => readFileSync(resolve(process.cwd(), 'src', f), 'utf8')
const css = src('index.css')
const chart = src('components/LineChart.jsx')
const files = ['index.css', ...readdirSync(resolve(process.cwd(), 'src/theme')).filter(f => f.endsWith('.css')).map(f => 'theme/' + f)]

const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))
const lin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05) }
const mix = (a, b, p) => a.map((v, i) => v * p + b[i] * (1 - p))

const blocks = files.flatMap(f => [...src(f).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => ({ f, sel: m[1].trim(), body: m[2] })))
const val = (body, name) => body.match(new RegExp('--' + name + ':\\s*(#[0-9a-fA-F]{6})\\b'))?.[1]
const base = { dark: { label: '#ffffff', surface: '#1c1c1e' }, light: { label: '#000000', surface: '#ffffff' } }

describe('chart text contrast', () => {
  const pct = Number(css.match(/\.lc-text\{fill:color-mix\(in srgb,var\(--label\) (\d+)%,var\(--surface\)\)\}/)?.[1])

  it('draws every chart label with .lc-text, none with a raw label token', () => {
    expect(pct).toBeGreaterThan(0)
    expect(chart.match(/<text[^>]*fill="var\(--label/g)).toBeNull()
    expect(chart.match(/<text[^>]*className="lc-text"/g)?.length).toBe(4)
  })

  it('reaches 4.5:1 on the card in every theme, light and dark', () => {
    const themed = blocks.filter(b => val(b.body, 'label') || val(b.body, 'surface'))
    expect(themed.length).toBeGreaterThan(5)
    for (const b of themed) {
      const fb = /light/.test(b.sel) ? base.light : base.dark
      const label = hex(val(b.body, 'label') || fb.label), surface = hex(val(b.body, 'surface') || fb.surface)
      const r = ratio(mix(label, surface, pct / 100), surface)
      expect(r, b.f + ' ' + b.sel).toBeGreaterThanOrEqual(4.5)
    }
  })
})
