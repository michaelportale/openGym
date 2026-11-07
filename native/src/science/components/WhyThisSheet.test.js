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

import { whyThis } from '../rules.js'
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

test('the sheet is not mounted from a screen, and Gus has the handoff', () => {
  const decisions = readFileSync(new URL('../../../../docs/science/decisions.md', import.meta.url), 'utf8')
  expect(decisions).toContain('WhyThisSheet')
  expect(decisions).toContain('does not mount it in any screen')
  const nativeRoot = fileURLToPath(new URL('../../', import.meta.url))
  for (const lane of ['app', 'workout', 'ui', 'session']) {
    const hits = filesUnder(join(nativeRoot, lane)).filter(path => readFileSync(path, 'utf8').includes('WhyThisSheet'))
    expect(hits).toEqual([])
  }
})
