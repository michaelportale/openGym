// Rounded numerals: one token, falling back to the body font off Apple
// platforms, applied to the set steppers and the timers.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const tokens = readFileSync(resolve(process.cwd(), 'src/theme/tokens.css'), 'utf8')
const index = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')

describe('--font-num', () => {
  it('starts with the rounded system face and ends on the body font stack', () => {
    const v = tokens.match(/--font-num:\s*([^;]+);/)?.[1]
    expect(v).toMatch(/^ui-rounded, 'SF Pro Rounded', -apple-system/)
    expect(v).toMatch(/system-ui, sans-serif$/)
  })
  it('is used by the set steppers and the timers', () => {
    const rule = index.match(/([^{}]+)\{font-family:var\(--font-num\)\}/)?.[1] || ''
    const sel = rule.split('*/').pop().split(',').map(s => s.trim())
    for (const s of ['.stp .num', '#timer .t', '#tabbar button.start .tab-time']) expect(sel).toContain(s)
  })
})
