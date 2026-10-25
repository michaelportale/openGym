// Gold means a personal record. Outside the record UI (.pr*, .finish-record*, record headings and
// trophies) nothing reads --pr or the raw --yellow: goals use --goal, warnings --warning, effort and
// the strength map the accent. The one exception is the user's own "gold" accent choice.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const src = fileURLToPath(new URL('..', import.meta.url))
const files = []
const walk = d => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.(css|jsx?|mjs)$/.test(p) && !/\.test\./.test(p) && !p.includes('/theme/') && !p.includes('/locales/')) files.push(p) } }
walk(src)
const GOLD = /var\(--(pr|yellow)\)/
const RECORD_SELECTOR = /(^|[\s.,>+~-])(pr|finish-pr|finish-record|record|pr-[\w-]+)([\s.,:>+~[{)]|$)|\.pr\b|pr-tile|finish-records?|records?-/

function goldOutsideRecords(name, text) {
  const out = []
  if (name.endsWith('.css')) {
    const clean = text.replace(/\/\*[\s\S]*?\*\//g, '')
    for (const rule of clean.split('}')) {
      const i = rule.indexOf('{'); if (i < 0) continue
      const sel = rule.slice(0, i).trim().split('{').pop().trim(), body = rule.slice(i + 1)
      if (!GOLD.test(body)) continue
      if (sel.includes('[data-accent="gold"]')) continue
      if (!RECORD_SELECTOR.test(sel)) out.push(sel)
    }
  } else {
    text.split('\n').forEach((line, n) => {
      if (/var\(--yellow\)/.test(line)) out.push(`${n + 1}: ${line.trim().slice(0, 80)}`)
      else if (/var\(--pr\)/.test(line) && !/trophy|record|\bpr\b|PR/.test(line)) out.push(`${n + 1}: ${line.trim().slice(0, 80)}`)
    })
  }
  return out
}

describe('gold only for records', () => {
  it('no stylesheet or component uses gold outside the record UI', () => {
    const hits = files.flatMap(f => goldOutsideRecords(f, readFileSync(f, 'utf8')).map(h => `${f.slice(src.length)}: ${h}`))
    expect(hits).toEqual([])
  })
  it('catches gold on a non-record selector and a goal colour in a component', () => {
    expect(goldOutsideRecords('a.css', '.fav-star{color:var(--yellow)} .pr{color:var(--pr)}')).toEqual(['.fav-star'])
    expect(goldOutsideRecords('a.jsx', "<b style={{ color: 'var(--yellow)' }} />\n<Icon name=\"trophy\" style={{ color: 'var(--pr)' }} />")).toHaveLength(1)
  })
})
