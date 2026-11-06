import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { scanSharedGraph } from './shared-lib-graph.mjs'

const fixture = name => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))

test('follows relative imports and reports no violations for clean code', () => {
  const { files, violations } = scanSharedGraph(fixture('clean-entry.js'))
  expect(files.map(f => basename(f)).sort()).toEqual(['clean-dep.js', 'clean-entry.js'])
  expect(violations).toEqual([])
})

test('names the file and token for a bare import and a browser global', () => {
  const { violations } = scanSharedGraph(fixture('bad-entry.js'))
  expect(violations.map(v => v.token)).toEqual(expect.arrayContaining(['@capacitor/core', 'localStorage']))
  expect(violations.every(v => basename(v.file) === 'bad-entry.js')).toBe(true)
})

test('ignores comments', () => {
  expect(scanSharedGraph(fixture('commented-entry.js')).violations).toEqual([])
})

test('allow list silences a named token in a named file only', () => {
  const allow = { 'bad-entry.js': ['localStorage'] }
  const tokens = scanSharedGraph(fixture('bad-entry.js'), allow).violations.map(v => v.token)
  expect(tokens).not.toContain('localStorage')
  expect(tokens).toContain('@capacitor/core')
})
