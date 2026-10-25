import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// Motion uses the duration tokens, and what moves is transform or opacity, so nothing re-lays out
// while it animates. The swipe panes widen with the finger and the rest bar ticks with the clock:
// those two are the listed exceptions.
const files = []
const walk = d => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.css')) files.push(p) } }
walk('src')
const transitions = files.flatMap(f => [...readFileSync(f, 'utf8').matchAll(/transition:([^;}]*)/g)].map(m => ({ f, v: m[1] })))
const css = readFileSync('src/index.css', 'utf8')

describe('motion', () => {
  it('defines the press and easing tokens', () => {
    for (const tok of ['--dur-press:90ms', '--press-scale:.97', '--ease-out:']) expect(css).toContain(tok)
  })
  it('defines no easing token that nothing uses', () => {
    const all = files.map(f => readFileSync(f, 'utf8')).join('\n')
    const defined = [...new Set([...css.matchAll(/(--ease[\w-]*):/g)].map(m => m[1]))]
    expect(defined.filter(tok => !all.includes('var(' + tok + ')'))).toEqual([])
  })
  it('styles the primary button press once', () => {
    expect(css.match(/\.btn\.primary:active\{/g)?.length).toBe(1)
  })
  it('writes no literal duration in a transition, apart from the rest bar\'s one-second tick and zero-length visibility flips', () => {
    const bad = transitions.filter(({ v }) => /(^|[\s,])\.?\d*\.?\d+m?s\b/.test(v.replace(/\b0s\b/g, '').replace(/1s linear/, '')))
    expect(bad).toEqual([])
  })
  it('animates no width in the workout progress bar or the rest bar', () => {
    expect(css).toMatch(/\.wprog i\{[^}]*transition:transform/)
    expect(css).toMatch(/#timer \.bar i\{[^}]*transition:transform 1s linear/)
  })
  it('shrinks a pressed button, row or tappable card by the one press scale', () => {
    expect(css).toContain('.btn:active{transform:scale(var(--press-scale))')
    expect(css).toContain('.lrow:active,.card.tappable:active,.today-row:active{transform:scale(var(--press-scale))}')
  })
  it('turns motion off under reduced motion', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\{\*\{animation:none!important;transition:none!important\}\}/)
  })
})
