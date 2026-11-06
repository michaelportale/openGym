import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { scanNativeBoundary, scanSharedGraph } from './shared-lib-graph.mjs'

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

const tokensOf = (name, allow) => scanSharedGraph(fixture(name), allow).violations.map(v => v.token)

test('a /* inside a string does not hide the code after it', () => {
  expect(tokensOf('string-comment-entry.js')).toEqual(expect.arrayContaining(['@capacitor/core', 'localStorage']))
})

test('a // inside a string does not hide the rest of the line', () => {
  expect(tokensOf('string-slashes-entry.js')).toContain('localStorage')
})

test.each([
  ['optional-window.js', 'window.'],
  ['optional-document.js', 'document.'],
  ['optional-navigator.js', 'navigator.']
])('catches optional chaining on %s', (name, token) => {
  expect(tokensOf(name)).toContain(token)
})

test.each(['global-this-entry.js', 'self-entry.js', 'window-storage-entry.js'])(
  'catches storage reached through a global object in %s',
  name => {
    expect(tokensOf(name)).toContain('localStorage')
  }
)

test('allowing window. does not exempt window.localStorage', () => {
  const tokens = tokensOf('window-storage-entry.js', { 'window-storage-entry.js': ['window.'] })
  expect(tokens).toContain('localStorage')
  expect(tokens).not.toContain('window.')
})

test('ordinary properties and string contents are not flagged', () => {
  expect(tokensOf('property-entry.js')).toEqual([])
})

test('flags require() and a non-literal import()', () => {
  expect(tokensOf('require-entry.js')).toContain('require(')
  expect(tokensOf('dynamic-import-entry.js')).toContain('import(')
})

test('flags imports that resolve to mobile.js or i18n.js', () => {
  expect(tokensOf('banned-entry.js')).toEqual(expect.arrayContaining(['mobile.js', 'i18n.js']))
})

test('follows JSON files without scanning them', () => {
  const { files, violations } = scanSharedGraph(fixture('json-entry.js'))
  expect(files.map(f => basename(f))).toContain('data.json')
  expect(violations).toEqual([])
})

test('flags a relative import that does not resolve', () => {
  expect(tokensOf('missing-entry.js')).toContain('./does-not-exist.js')
})

test('allow list is scoped to the named file', () => {
  const tokens = tokensOf('bad-entry.js', { 'other.js': ['localStorage', '@capacitor/core'] })
  expect(tokens).toEqual(expect.arrayContaining(['localStorage', '@capacitor/core']))
})

test('native boundary: names files that import from frontend/', () => {
  const dir = fixture('boundary')
  const files = ['ok.js', 'bad.js', 'sibling.js'].map(n => `${dir}/native/${n}`)
  const violations = scanNativeBoundary(files, `${dir}/frontend`)
  expect(violations.map(v => basename(v.file))).toEqual(['bad.js'])
  expect(violations[0].spec).toBe('../frontend/lib.js')
})
