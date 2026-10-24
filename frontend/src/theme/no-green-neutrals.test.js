// Light workout neutrals and the accent fallbacks carry no green tint: done is chalk/ink, the
// accent is the palette's, and the light workout screen is not olive.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8')
const hsl = hex => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn
  if (!d) return [0, 0, l]
  const s = d / (1 - Math.abs(2 * l - 1))
  const h = mx === r ? 60 * (((g - b) / d) % 6) : mx === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4)
  return [(h + 360) % 360, s, l]
}
const greenish = hex => { const [h, s] = hsl(hex); return s >= 0.04 && h >= 60 && h <= 170 }
const blockOf = (css, sel) => css.slice(css.indexOf(sel), css.indexOf('}', css.indexOf(sel)))

describe('no green neutrals', () => {
  it('the light workout screen uses neutral or warm greys', () => {
    const b = blockOf(read('../views/WorkoutLedger.css'), ':root[data-theme="light"] body.no-tabbar')
    const hexes = b.match(/#[0-9a-f]{6}/gi)
    expect(hexes.length).toBeGreaterThan(5)
    expect(hexes.filter(greenish)).toEqual([])
    const ember = blockOf(read('./theme-ember.css'), ':root[data-theme="light"][data-palette="ember"] body.no-tabbar')
    expect(ember.match(/#[0-9a-f]{6}/gi).filter(greenish)).toEqual([])
  })
  it('the accent fallback is not the system green', () => {
    const root = blockOf(read('../index.css'), ':root {')
    expect(root).not.toMatch(/--acc:\s*var\(--green\)/)
    expect(root).not.toMatch(/--acc-2:\s*#248a3d/)
  })
  it('flags the old olive values (the check works)', () => {
    expect(['#515a4d', '#e9ece4', '#adb5a6'].every(greenish)).toBe(true)
  })
})
