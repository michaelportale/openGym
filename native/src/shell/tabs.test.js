import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { color } from '../theme/tokens.js'
import { TABS, installWebTabFit, pinnedTabColor, screenFrame, screenTopInset, tabBarColors, tabLabelStyle } from './tabs.js'

test('the five tabs stay in PRD order and keep their visible names', () => {
  expect(TABS.map(tab => [tab.name, tab.label])).toEqual([
    ['home', 'Home'],
    ['plan', 'Plan'],
    ['index', 'Workout'],
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
  expect(bar.backgroundColor).toBe(color.surface)
  expect(bar.labelStyle.selected.color).not.toBe(bar.labelStyle.default.color)
})

test('web clears the fixed tab pill and native screens do not add that inset', () => {
  expect(screenTopInset('web')).toBeGreaterThanOrEqual(64)
  expect(screenTopInset('ios')).toBe(0)
  expect(tabLabelStyle('ios').default.fontSize).toBeUndefined()
  expect(tabLabelStyle('web').default.fontSize).toBe(13)
  expect(tabLabelStyle('web').selected.color).toBe(color.accent)
  expect(screenFrame('web')).toEqual({ flex: 1, width: '100%', paddingTop: screenTopInset('web') })
  expect(screenFrame('ios').paddingTop).toBe(0)
  expect(screenFrame('ios').width).toBe('100%')
})

test('web tab fit keeps every label in the pill and does not install twice', () => {
  const style = {}
  const doc = {
    head: { appendChild: node => { style.node = node } },
    createElement: () => style,
    getElementById: id => style.id === id ? style : null
  }
  expect(installWebTabFit(doc)).toBe(true)
  expect(style.id).toBe('opengym-web-tabs')
  expect(style.textContent).toContain('[role="tab"]')
  expect(style.textContent).toContain('padding-left:8px')
  expect(installWebTabFit(doc)).toBe(false)
  expect(installWebTabFit(null)).toBe(false)
})

test('only the workout tab opts out of automatic content insets', () => {
  expect(TABS.filter(tab => tab.disableAutomaticContentInsets).map(tab => tab.label)).toEqual(['Workout'])
})

// Expo Router 58 picks the launch screen from the URL, and a cold launch is '/', the index route.
test('the app opens on Workout: the launch route is the Workout tab, and Home is its own route', () => {
  expect(TABS.find(tab => tab.label === 'Workout').name).toBe('index')
  const read = file => readFileSync(new URL(`../app/(tabs)/${file}`, import.meta.url), 'utf8')
  expect(read('index.js')).toContain('useWorkoutHome')
  expect(read('home.js')).toContain("destinationCopy('home')")
})

test('workout and exercises are ready and the other three tabs are unbuilt', () => {
  expect(TABS.filter(tab => tab.availability === 'ready').map(tab => tab.label)).toEqual(['Workout', 'Exercises'])
  expect(TABS.filter(tab => tab.availability === 'unbuilt').map(tab => tab.label)).toEqual([
    'Home', 'Plan', 'Progress'
  ])
  expect(TABS.some(tab => tab.availability === 'preview')).toBe(false)
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

// A render throw on the phone holding the only record must not become a crash loop.
test('the Workout route has an error boundary with the error, Retry and Export', () => {
  const route = readFileSync(new URL('../app/(tabs)/index.js', import.meta.url), 'utf8')
  expect(route).toMatch(/export function ErrorBoundary\(\{ error, retry \}\)/)
  const screen = readFileSync(new URL('../workout/WorkoutError.js', import.meta.url), 'utf8')
  expect(screen).toContain('error?.message')
  expect(screen).toContain('onPress={retry}')
  expect(screen).toContain('<ExportButton')
})

test('the tab host uses the shared colours and the five-tab list', () => {
  const src = readFileSync(new URL('../app/(tabs)/_layout.js', import.meta.url), 'utf8')
  expect(src).toContain('tabBarColors')
  expect(src).toContain('pinnedTabColor')
  expect(src).toContain('TABS')
  expect(src).toContain('accessibilityLabel={tab.label}')
  expect(src).not.toContain('labelStyle={{ color:')
})
