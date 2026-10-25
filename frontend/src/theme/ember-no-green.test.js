// Ember draws no green anywhere: every custom property the palette resolves, dark and light, is
// checked for a green hue, including done (--success), which is chalk in dark and graphite in light.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = p => readFileSync(resolve(process.cwd(), 'src', p), 'utf8')
const index = read('index.css'), tokens = read('theme/tokens.css'), ember = read('theme/theme-ember.css')

const blockOf = (css, sel) => {
  const i = css.indexOf(sel + ' {') >= 0 ? css.indexOf(sel + ' {') : css.indexOf(sel + '{')
  if (i < 0) throw new Error('missing block ' + sel)
  return css.slice(css.indexOf('{', i) + 1, css.indexOf('}', i))
}
const decls = body => Object.fromEntries([...body.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]))

// Named system colours are only reached through a preset the user picks (the lime accent is an open
// question); what matters is that no Ember token points at them.
const PRIMITIVES = new Set(['--blue', '--green', '--red', '--orange', '--yellow', '--purple', '--pink', '--teal', '--indigo', '--mint', '--cyan', '--brown'])

const resolveAll = map => {
  const out = {}
  const val = (name, seen = new Set()) => {
    if (seen.has(name) || !(name in map)) return { v: '', refs: [] }
    seen.add(name)
    const refs = []
    const v = map[name].replace(/var\((--[\w-]+)(?:,\s*([^)]*))?\)/g, (_, n, fb) => {
      refs.push(n)
      const r = val(n, new Set(seen)); refs.push(...r.refs)
      return r.v || fb || ''
    })
    return { v, refs }
  }
  for (const n of Object.keys(map)) out[n] = val(n)
  return out
}

const hexes = s => [...s.matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})\b/gi)].map(m => m[1].length === 3 ? '#' + [...m[1]].map(c => c + c).join('') : '#' + m[1])
const rgbs = s => [...s.matchAll(/rgba?\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)/g)].map(m => '#' + m.slice(1, 4).map(x => (+x).toString(16).padStart(2, '0')).join(''))
const hsl = hex => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn
  if (!d) return [0, 0, l]
  const s = d / (1 - Math.abs(2 * l - 1))
  const h = mx === r ? 60 * (((g - b) / d) % 6) : mx === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4)
  return [(h + 360) % 360, s, l]
}
export const greenish = hex => { const [h, s] = hsl(hex); return s >= 0.04 && h >= 70 && h <= 170 }

const MODES = {
  dark: [decls(blockOf(index, ':root')), decls(blockOf(tokens, ':root')),
    decls(blockOf(ember, ':root[data-theme="ember"]')), decls(blockOf(ember, ':root[data-theme="ember"][data-accent="theme"]'))],
  light: [decls(blockOf(index, ':root')), decls(blockOf(index, ':root[data-theme="light"]')), decls(blockOf(tokens, ':root')),
    decls(blockOf(ember, ':root[data-theme="light"][data-palette="ember"]')), decls(blockOf(ember, ':root[data-theme="light"][data-palette="ember"][data-accent="theme"]'))],
}

describe('Ember resolves no token to green', () => {
  for (const [mode, layers] of Object.entries(MODES)) {
    it(mode, () => {
      const all = resolveAll(Object.assign({}, ...layers))
      const bad = Object.entries(all).filter(([n]) => !PRIMITIVES.has(n)).flatMap(([n, { v, refs }]) => [
        ...(refs.includes('--green') ? [`${n} -> var(--green)`] : []),
        ...[...hexes(v), ...rgbs(v)].filter(greenish).map(h => `${n} = ${h}`),
      ])
      expect(bad).toEqual([])
      expect(Object.keys(all).length).toBeGreaterThan(60)
    })
  }
  it('done is chalk in dark and graphite in light, apart from the accent and the record gold', () => {
    const d = resolveAll(Object.assign({}, ...MODES.dark)), l = resolveAll(Object.assign({}, ...MODES.light))
    expect(d['--success'].v.toLowerCase()).toBe('#e9e1d3')
    expect(l['--success'].v.toLowerCase()).toBe('#5c5346')
    for (const m of [d, l]) {
      expect(m['--success'].v).not.toBe(m['--acc'].v)
      expect(m['--success'].v).not.toBe(m['--pr'].v)
    }
  })
  it('the check catches the system green and an olive', () => {
    expect(['#30d158', '#34c759', '#248a3d', '#515a4d'].every(greenish)).toBe(true)
    expect(['#e9e1d3', '#5c5346', '#ff5a1f'].some(greenish)).toBe(false)
  })
})
