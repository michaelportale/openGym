import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { symbolPresentation } from './symbol-fallback.js'

const USED = ['ellipsis', 'plus', 'checkmark.circle.fill', 'square', 'dumbbell', 'chevron.right']

test('iOS keeps the SF Symbol name', () => {
  for (const name of USED) {
    expect(symbolPresentation(name, 'ios')).toEqual({ kind: 'sf-symbol', name })
  }
})

test('other platforms get a visible glyph and do not receive the SF Symbol name', () => {
  for (const os of ['web', 'android']) {
    for (const name of USED) {
      const presentation = symbolPresentation(name, os)
      expect(presentation.kind).toBe('text')
      expect(presentation.text.length).toBeGreaterThan(0)
      expect(presentation.text).not.toBe(name)
    }
  }
  expect(symbolPresentation('ellipsis', 'web').text).toBe('…')
  expect(symbolPresentation('plus', 'web').text).toBe('+')
})

test('iOS accepts an SF Symbol that has no text glyph', () => {
  expect(symbolPresentation('gear', 'ios')).toEqual({ kind: 'sf-symbol', name: 'gear' })
})

test('an unknown symbol stays blank nowhere except iOS', () => {
  expect(() => symbolPresentation('gear', 'web')).toThrow('No visible fallback')
  expect(() => symbolPresentation('gear', 'android')).toThrow('No visible fallback')
  expect(() => symbolPresentation('', 'ios')).toThrow('Symbol name is required')
  expect(() => symbolPresentation('constructor', 'web')).toThrow('No visible fallback')
  // Nothing on screen pauses: the fallback names only symbols the app draws.
  expect(() => symbolPresentation('pause.fill', 'web')).toThrow('No visible fallback')
  expect(() => symbolPresentation(undefined, 'web')).toThrow('Symbol name is required')
})

test('call sites draw the shared symbol, not a string-only SymbolView', () => {
  for (const file of ['IconButton.js', '../workout/SetRow.js', '../workout/UpNextRow.js']) {
    const src = readFileSync(new URL(file, import.meta.url), 'utf8')
    expect(src).toContain('NativeSymbol')
    expect(src).not.toContain("from 'expo-symbols'")
  }
})
