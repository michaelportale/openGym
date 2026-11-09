import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, vi } from 'vitest'

vi.mock('react-native', () => {
  const { createElement } = require('react')
  const host = type => function Host(props) {
    return createElement(type, props, props.children)
  }
  return { View: host('View'), Text: host('Text') }
})

import { RULES, whyThis } from '../rules.js'
import { whySheetModel } from '../why-sheet.js'
import { WhyThisSheet } from './WhyThisSheet.jsx'

function texts(node, out = []) {
  if (node == null || typeof node === 'boolean') return out
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node))
    return out
  }
  if (Array.isArray(node)) {
    node.forEach(child => texts(child, out))
    return out
  }
  if (node.props) texts(node.props.children, out)
  return out
}

test('a definition payload keeps its reason, source, and label', () => {
  const payload = whyThis('warmup-accounting')
  const model = whySheetModel(payload)
  expect(model.reason).toBe(payload.reason)
  expect(model.source).toBe('Definition')
  expect(model.label).toBe('Definition')
})

test('a convention payload is labeled Convention and a cited rule is not', () => {
  expect(whySheetModel(whyThis('deload-after-misses')).label).toBe('Convention')
  expect(whySheetModel(whyThis('warmup-loads')).label).toBe(null)
  expect(whySheetModel(whyThis('warmup-loads')).source).toContain('PMC7558980')
})

test('a TODO or missing population is never rendered', () => {
  for (const rule of Object.values(RULES)) {
    const payload = whyThis(rule.id)
    const shown = texts(WhyThisSheet({ payload }))
    expect(shown.join('\n')).not.toMatch(/\bTODO\b/)
    if (!payload.population) expect(shown).not.toContain('Population')
  }
  const base = whyThis('warmup-loads')
  for (const population of ['TODO', 'todo', ' TODO ', '', '   ', undefined, null]) {
    const payload = { ...base, population }
    expect(whySheetModel(payload).population).toBeNull()
    const shown = texts(WhyThisSheet({ payload }))
    expect(shown).not.toContain('Population')
    expect(shown.join('\n')).not.toMatch(/TODO/i)
  }
  const stated = { ...base, population: 'stated by a source' }
  const shown = texts(WhyThisSheet({ payload: stated }))
  expect(RULES['warmup-loads'].population).toBe('TODO')
  expect(shown).toContain('Population')
  expect(shown).toContain('stated by a source')
})

test('the sheet renders the reason, the source, and the plain label', () => {
  const payload = whyThis('rest-defaults')
  const tree = WhyThisSheet({ payload })
  const shown = texts(tree)
  expect(shown).toContain('Convention')
  expect(shown).toContain(payload.reason)
  expect(shown).toContain(payload.source)
  expect(tree.props.accessibilityRole).toBe('summary')
})

function filesUnder(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name)
    return entry.isDirectory() ? filesUnder(path) : [path]
  })
}

test('only the workout WhySheet host mounts the sheet, and Gus has the handoff', () => {
  const decisions = readFileSync(new URL('../../../../docs/science/decisions.md', import.meta.url), 'utf8')
  expect(decisions).toContain('WhyThisSheet')
  expect(decisions).toContain('mounted only by `native/src/workout/WhySheet.js`')
  const nativeRoot = fileURLToPath(new URL('../../', import.meta.url))
  // Every lane but science/ itself, so a new lane that hosts a Why sheet is held to it too.
  const lanes = readdirSync(nativeRoot, { withFileTypes: true }).filter(entry => entry.isDirectory() && entry.name !== 'science').map(entry => entry.name)
  expect(lanes).toEqual(expect.arrayContaining(['app', 'workout', 'ui', 'session', 'progress', 'exercises']))
  const hits = lanes.flatMap(lane => filesUnder(join(nativeRoot, lane))).filter(path => readFileSync(path, 'utf8').includes('WhyThisSheet'))
  expect(hits.map(path => path.slice(nativeRoot.length))).toEqual(['workout/WhySheet.js'])
})
