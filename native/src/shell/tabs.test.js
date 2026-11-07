import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { color } from '../theme/tokens.js'
import { TABS, pinnedTabColor, tabBarColors } from './tabs.js'

test('the five tabs stay in PRD order and keep their visible names', () => {
  expect(TABS.map(tab => [tab.name, tab.label])).toEqual([
    ['index', 'Home'],
    ['plan', 'Plan'],
    ['workout', 'Workout'],
    ['progress', 'Progress'],
    ['exercises', 'Exercises']
  ])
})

test('every tab can be selected and announces its visible name', () => {
  expect(new Set(TABS.map(tab => tab.name)).size).toBe(TABS.length)
  for (const tab of TABS) {
    expect(tab.disabled).toBeUndefined()
    expect(tab.label).toMatch(/\S/)
    expect(tab.sf.default).toMatch(/\S/)
    expect(tab.sf.selected).toMatch(/\S/)
  }
})

test('the selected tab uses accent and the others use secondary', () => {
  const bar = tabBarColors()
  expect(bar.labelStyle.selected.color).toBe(color.accent)
  expect(bar.labelStyle.default.color).toBe(color.textSecondary)
  expect(bar.iconColor.selected).toBe(color.accent)
  expect(bar.iconColor.default).toBe(color.textSecondary)
  expect(bar.tintColor).toBe(color.accent)
  expect(bar.labelStyle.selected.color).not.toBe(bar.labelStyle.default.color)
})

test('only the workout tab opts out of automatic content insets', () => {
  expect(TABS.filter(tab => tab.disableAutomaticContentInsets).map(tab => tab.name)).toEqual(['workout'])
})

test('workout is a preview and the other four tabs are unbuilt', () => {
  expect(TABS.find(tab => tab.name === 'workout').availability).toBe('preview')
  expect(TABS.filter(tab => tab.availability === 'unbuilt').map(tab => tab.label)).toEqual([
    'Home', 'Plan', 'Progress', 'Exercises'
  ])
  expect(TABS.some(tab => tab.availability === 'ready')).toBe(false)
})

test('iOS pins both appearances to the same colour and other platforms keep the hex', () => {
  const calls = []
  const dynamicColor = spec => {
    calls.push(spec)
    return { pinned: spec.dark }
  }
  expect(pinnedTabColor(color.accent, 'web', dynamicColor)).toBe(color.accent)
  expect(calls).toEqual([])
  expect(pinnedTabColor(color.accent, 'ios', dynamicColor)).toEqual({ pinned: color.accent })
  expect(calls).toEqual([{ dark: color.accent, light: color.accent }])
})

test('a tab colour that is not hex is rejected', () => {
  expect(() => pinnedTabColor('accent', 'web', () => {})).toThrow('accent')
})

test('the tab host uses the shared colours and the five-tab list', () => {
  const src = readFileSync(new URL('../app/(tabs)/_layout.js', import.meta.url), 'utf8')
  expect(src).toContain('tabBarColors')
  expect(src).toContain('pinnedTabColor')
  expect(src).toContain('TABS')
  expect(src).toContain('accessibilityLabel={tab.label}')
  expect(src).not.toContain('labelStyle={{ color:')
})
