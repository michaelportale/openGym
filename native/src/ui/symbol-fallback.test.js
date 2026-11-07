import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { symbolPresentation } from './symbol-fallback.js'

const USED = ['ellipsis', 'pause.fill', 'plus', 'checkmark.circle.fill', 'square', 'dumbbell', 'chevron.right']

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
  expect(symbolPresentation('pause.fill', 'web').text).toBe('II')
  expect(symbolPresentation('plus', 'web').text).toBe('+')
})

test('an unknown symbol fails instead of rendering blank', () => {
  expect(() => symbolPresentation('', 'web')).toThrow('No visible fallback')
  expect(() => symbolPresentation('constructor', 'web')).toThrow('No visible fallback')
  expect(() => symbolPresentation('gear', 'ios')).toThrow('No visible fallback')
  expect(() => symbolPresentation(undefined, 'web')).toThrow('No visible fallback')
})

test('call sites draw the shared symbol, not a string-only SymbolView', () => {
  for (const file of ['IconButton.js', '../workout/SetRow.js', '../workout/UpNextRow.js']) {
    const src = readFileSync(new URL(file, import.meta.url), 'utf8')
    expect(src).toContain('NativeSymbol')
    expect(src).not.toContain("from 'expo-symbols'")
  }
})
