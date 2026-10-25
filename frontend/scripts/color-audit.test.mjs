import { describe, expect, it } from 'vitest'
import { stripJs, stripCss, isGreenRgb } from './color-audit.mjs'

describe('color-audit', () => {
  it('blanks comments but keeps strings, nested templates and regex literals', () => {
    const src = "const a = '#30d158' // issue (#275)\nconst b = `x ${c ? '' : `<i style=\"color:#fff\">`} y` /* #123 */\nconst r = /\\/\\/#abc/\n"
    const out = stripJs(src)
    expect(out).toHaveLength(src.length)
    expect(out).toContain("'#30d158'")
    expect(out).not.toContain('#275')
    expect(out).toContain('color:#fff')
    expect(out).not.toContain('#123')
    expect(out).toContain('/\\/\\/#abc/')
  })
  it('strips CSS comments', () => {
    expect(stripCss('a{color:#fff} /* #282 */')).not.toContain('#282')
  })
  it('calls lime and iOS green green, and yellow, orange and greys not', () => {
    expect(isGreenRgb([0x30, 0xd1, 0x58])).toBe(true)
    expect(isGreenRgb([0xa3, 0xe6, 0x35])).toBe(true)
    expect(isGreenRgb([0xff, 0xd6, 0x0a])).toBe(false)
    expect(isGreenRgb([0xff, 0x6b, 0x35])).toBe(false)
    expect(isGreenRgb([0x3c, 0x40, 0x3c])).toBe(false)
  })
})
