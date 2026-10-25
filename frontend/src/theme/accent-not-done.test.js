import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// The accent fill is for the one thing to press next (the primary action, the active tab, the
// Start button). A logged set or a trained day is done, and done is --success with its check.
const css = readFileSync('src/index.css', 'utf8')
const rule = sel => {
  const i = css.indexOf('\n' + sel + '{')
  expect(i, sel).toBeGreaterThan(-1)
  return css.slice(i, css.indexOf('}', i))
}

describe('done is not the accent', () => {
  it('a logged set\'s check is --success', () => {
    expect(rule('.chk.on')).toContain('background:var(--success)')
  })
  for (const sel of ['.chk.on', '.setrow.done .n', '.setrow.side.done .sidetag', '.wday .dot.done']) {
    it(`${sel} carries no accent`, () => { expect(rule(sel)).not.toMatch(/var\(--acc\b/) })
  }
})
