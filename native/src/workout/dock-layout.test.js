import { expect, test } from 'vitest'
import { touch } from '../theme/tokens.js'
import { dockFits } from './dock-layout.js'

const rows = n => n * touch.primary

test('stays pinned until the screen has been measured', () => {
  expect(dockFits({ screen: 0, head: 0, dock: 0 })).toBe(true)
})
test('pins while the fixed parts leave room for three rows', () => {
  expect(dockFits({ screen: 710, head: 210, dock: 179 })).toBe(true)
  expect(dockFits({ screen: rows(3) + 300, head: 200, dock: 100 })).toBe(true)
})
test('stops pinning once they do not, so large text can scroll', () => {
  expect(dockFits({ screen: rows(3) + 299, head: 200, dock: 100 })).toBe(false)
  expect(dockFits({ screen: 710, head: 900, dock: 313 })).toBe(false)
})
