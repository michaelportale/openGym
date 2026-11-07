import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { destinationCopy } from './destinations.js'

const ids = ['home', 'plan', 'progress', 'exercises']

test('every unbuilt destination says it is not built and records nothing', () => {
  for (const id of ids) {
    const copy = destinationCopy(id)
    expect(copy.status).toBe('Not built yet')
    expect(copy.recorded).toBe(false)
    expect(copy.summary).not.toMatch(/available now|workout saved|synced to/i)
  }
})

test('home does not promise a single phase', () => {
  const home = destinationCopy('home')
  expect(home.title).toBe('Home')
  expect(home.phase).toBeNull()
  expect(home.phaseLabel).toBeNull()
  expect(home.summary).toMatch(/not built/i)
  expect(home.summary).toMatch(/nutrition/i)
  expect(home.summary).toMatch(/Nothing on this screen is logged, saved, or synced/)
})

test('plan, progress and exercises name phase 7, and progress names WHOOP later', () => {
  expect(destinationCopy('plan').phaseLabel).toBe('Arrives in Phase 7')
  expect(destinationCopy('exercises').phaseLabel).toBe('Arrives in Phase 7')
  const progress = destinationCopy('progress')
  expect(progress.phaseLabel).toBe('Arrives in Phase 7')
  expect(progress.summary).toMatch(/Phase 8/)
})

test('an unknown destination throws', () => {
  expect(() => destinationCopy('workout')).toThrow('workout')
  expect(() => destinationCopy('constructor')).toThrow('constructor')
})

test('the four screens render the shared copy', () => {
  for (const id of ids) {
    const file = id === 'home' ? 'index.js' : `${id}.js`
    const src = readFileSync(new URL(`../app/(tabs)/${file}`, import.meta.url), 'utf8')
    expect(src).toContain(`destinationCopy('${id}')`)
    expect(src).toContain('status={copy.status}')
    expect(src).toContain('phaseLabel={copy.phaseLabel}')
  }
})
