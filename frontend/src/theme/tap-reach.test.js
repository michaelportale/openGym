import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Controls painted smaller than 44px reach 44px through an invisible ::before. The extension is
// computed from the element's own size, so a control sized down inline still gets there.
const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8').replace(/\s+/g, ' ')
const REACH = 'min(-6px, calc((100% - 44px) / 2))'

describe('44pt reach', () => {
  it('icon buttons at any size', () => { expect(css).toContain(`.iconbtn::before{inset:${REACH}}`) })
  it('segments, vertically only', () => { expect(css).toContain(`.seg button::before{inset-block:${REACH};inset-inline:0}`) })
  it('small buttons, the back link, Show more and switches', () => {
    for (const sel of ['.btn.sm', '.sp-back', '.weekly-volume-toggle', '.sw']) {
      expect(css).toMatch(new RegExp(`[,}]\\s*${sel.replace(/\./g, '\\.')}(,[^{]*)?\\{position:relative\\}`))
      expect(css).toMatch(new RegExp(`${sel.replace(/\./g, '\\.')}::before(,[^{]*)?\\{content:'';position:absolute;inset-block:min\\(0px, calc\\(\\(100% - 44px\\) / 2\\)\\);inset-inline:0\\}`))
    }
  })
  it('the reach at the sizes in use', () => {
    const reach = (h, floor) => h + 2 * Math.max(-Math.min(floor, (h - 44) / 2), 0)
    for (const h of [28, 30, 31, 34, 35, 42]) expect(reach(h, 0)).toBeGreaterThanOrEqual(44)
    expect(reach(30, -6)).toBe(44)
  })
})
