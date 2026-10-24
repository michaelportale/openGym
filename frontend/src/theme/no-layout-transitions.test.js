import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

// Motion moves by transform and opacity, so nothing reflows mid-animation. Two exceptions stay:
// the switch knob stretching while pressed (as the system switch does) and the swipe action
// growing to full width, both sized by the gesture itself.
const ALLOW = [/^\.sw \.knob$/, /^\.swpane button$/]
const LAYOUT = /\b(width|height|max-height|min-height|top|left|right|bottom|inset[a-z-]*|margin[a-z-]*|padding[a-z-]*|flex-basis|grid-template[a-z-]*)\b/

describe('no layout-property transitions or keyframes', () => {
  const dir = resolve(process.cwd(), 'src')
  const files = readdirSync(dir).filter(f => f.endsWith('.css'))
  it('finds the stylesheets', () => { expect(files).toContain('index.css') })
  for (const f of files) {
    it(f, () => {
      const css = readFileSync(resolve(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
      const bad = []
      for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const sel = m[1].trim()
        for (const d of m[2].split(';')) {
          const [prop, ...rest] = d.split(':'); const val = rest.join(':')
          if (/^\s*transition(-property)?\s*$/.test(prop || '') && LAYOUT.test(val) && !ALLOW.some(r => r.test(sel))) bad.push(`${sel} → ${d.trim()}`)
        }
      }
      for (const k of css.matchAll(/@keyframes\s+([\w-]+)\s*\{((?:[^{}]*\{[^{}]*\})*)\s*\}/g)) {
        for (const step of k[2].matchAll(/\{([^{}]*)\}/g)) {
          for (const d of step[1].split(';')) { const p = d.split(':')[0].trim(); if (p && LAYOUT.test(p) && !/^--/.test(p)) bad.push(`@keyframes ${k[1]} → ${d.trim()}`) }
        }
      }
      expect(bad).toEqual([])
    })
  }
})
