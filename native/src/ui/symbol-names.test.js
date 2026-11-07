import { expect, test } from 'vitest'
import { fileURLToPath } from 'node:url'
import { symbolPresentation } from './symbol-fallback.js'
import { scanSymbolSources, scanSymbolTree } from './symbol-names.js'

const button = `import NativeSymbol from './NativeSymbol'
export default function IconButton({ symbol, label }) {
  return label ? null : <NativeSymbol name={symbol} />
}
`

test('the tree names every symbol and each one has a web glyph', () => {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const { names, unresolved } = scanSymbolTree(root)
  expect(unresolved).toEqual([])
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
