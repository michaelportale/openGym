import { readFileSync } from 'node:fs'
import { sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { symbolPresentation } from '../src/ui/symbol-fallback.js'
import { nativeSourceFiles } from './shared-lib-graph.mjs'
import { scanSymbolSources, scanSymbolTree } from './symbol-names.mjs'

const appSrc = fileURLToPath(new URL('../src/', import.meta.url))
const nativeRoot = fileURLToPath(new URL('..', import.meta.url))

const button = `import NativeSymbol from './NativeSymbol'
export default function IconButton({ symbol, label }) {
  return label ? null : <NativeSymbol name={symbol} />
}
`

test('the app tree names every symbol and each one has a web glyph', () => {
  const { files, names, unresolved } = scanSymbolTree(appSrc)
  expect(unresolved).toEqual([])
  expect(files.some(file => file.endsWith('ui/IconButton.js'))).toBe(true)
  expect(files.some(file => file.includes('scripts') || file.includes('fixtures'))).toBe(false)
  expect(names).toEqual([
    'checkmark.circle.fill',
    'chevron.right',
    'dumbbell',
    'ellipsis',
    'pause.fill',
    'plus',
    'square'
  ])
  for (const name of names) {
    expect(symbolPresentation(name, 'web').text.length).toBeGreaterThan(0)
    expect(symbolPresentation(name, 'ios')).toEqual({ kind: 'sf-symbol', name })
  }
})

test('a prop the scanner cannot follow fails before a blank glyph ships', () => {
  const scanned = scanSymbolSources([
    { filename: 'IconButton.js', source: button },
    {
      filename: 'Row.js',
      source: `import IconButton from './IconButton'
export function Row({ icon }) { return <IconButton symbol={icon} /> }`
    }
  ])
  expect(scanned.unresolved.map(item => item.reason)).toContain('IconButton symbol is not a string')
})

test('a spread cannot hide a symbol name', () => {
  const scanned = scanSymbolSources([
    { filename: 'IconButton.js', source: button },
    {
      filename: 'Row.js',
      source: `import IconButton from './IconButton'
export function Row(props) { return <IconButton {...props} /> }`
    }
  ])
  expect(scanned.unresolved.map(item => item.reason)).toContain('IconButton receives a spread')
})

test('an unmapped literal is still visible to the test', () => {
  const scanned = scanSymbolSources([{
    filename: 'Row.js',
    source: `import NativeSymbol from './NativeSymbol'
export function Row() { return <NativeSymbol name="gear" /> }`
  }])
  expect(scanned.unresolved).toEqual([])
  expect(scanned.names).toEqual(['gear'])
  expect(symbolPresentation('gear', 'ios')).toEqual({ kind: 'sf-symbol', name: 'gear' })
  expect(() => symbolPresentation('gear', 'web')).toThrow('No visible fallback')
})

test('the scanner stays out of the app bundle', () => {
  expect(() => scanSymbolTree(nativeRoot)).toThrow('app src directory')
  expect(() => scanSymbolTree(fileURLToPath(new URL('./fixtures/', import.meta.url)))).toThrow('app src directory')
  const appFiles = nativeSourceFiles(nativeRoot)
  expect(appFiles.some(file => file.includes(`${sep}symbol-names.`))).toBe(false)
  for (const file of appFiles) {
    const source = readFileSync(file, 'utf8')
    expect(source, file).not.toMatch(/symbol-names/)
    expect(source, file).not.toMatch(/['"]node:/)
  }
})
