// Small text reaches 4.5:1: the label tiers in Ember (dark and light) and accent-coloured text,
// which reads --acc-text so light mode can darken it without darkening the fills.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { contrast } from '../lib/accent.js'

const here = fileURLToPath(new URL('.', import.meta.url))
const ember = readFileSync(join(here, 'theme-ember.css'), 'utf8')
const block = sel => { const i = ember.indexOf(sel + ' {'); return ember.slice(i, ember.indexOf('}', i)) }
const val = (b, k) => b.match(new RegExp(`--${k}: (#[0-9a-f]{6})`))[1]

describe('text contrast', () => {
  it('dark Ember labels pass 4.5:1 on the cards they sit on', () => {
    const d = block(':root[data-theme="ember"]')
    for (const bg of [val(d, 'surface'), val(d, 'surface-2')]) expect(contrast(val(d, 'label-3'), bg)).toBeGreaterThanOrEqual(4.5)
  })
  it('light Ember labels and accent text pass 4.5:1 on white and on the grouped grey', () => {
    const l = block(':root[data-theme="light"][data-palette="ember"]')
    const a = block(':root[data-theme="light"][data-palette="ember"][data-accent="theme"]')
    for (const bg of ['#ffffff', '#f2f2f7']) {
      for (const k of ['label-2', 'label-3']) expect(contrast(val(l, k), bg)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(val(a, 'acc-text'), bg)).toBeGreaterThanOrEqual(4.5)
    }
  })
  it('stylesheets colour text with --acc-text, not the --acc fill', () => {
    const src = join(here, '..')
    const files = []
    const walk = d => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.css') && !p.includes('/theme/')) files.push(p) } }
    walk(src)
    const hits = files.flatMap(f => (readFileSync(f, 'utf8').match(/(?<![-\w])color:\s*var\(--acc\)/g) || []).map(() => f))
    expect(hits).toEqual([])
  })
})
