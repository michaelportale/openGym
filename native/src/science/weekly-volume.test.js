import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { RULES } from './rules.js'
import { weeklyVolumeTarget, weeklyVolumeWhy } from './weekly-volume.js'

test('no weekly set target ships', () => {
  expect(weeklyVolumeTarget()).toBeNull()
  expect(typeof weeklyVolumeTarget()).not.toBe('number')
  expect(RULES['weekly-volume'].claim.toLowerCase()).toContain('no weekly volume targets')
  expect(RULES['weekly-volume'].population).toBe('TODO')
  const why = weeklyVolumeWhy()
  expect(why.ruleId).toBe('weekly-volume')
  expect(why.source).toContain('https://sponet.de/sponet/Record/4097139?lng=en')
  expect(why).not.toHaveProperty('population')
})

test('the refusal is written down for the screen', () => {
  const decisions = readFileSync(new URL('../../../docs/science/decisions.md', import.meta.url), 'utf8')
  expect(decisions).toContain('weeklyVolumeTarget')
  expect(decisions).toContain('returns null')
  const status = readFileSync(new URL('../../../docs/science/phase-4-status.md', import.meta.url), 'utf8')
  const line = status.split('\n').find(row => row.includes('Weekly volume'))
  expect(line).toMatch(/[Nn]ot started/)
  expect(line).toContain('weeklyVolumeTarget')
  expect(line).toContain('#43')
})
