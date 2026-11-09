import { describe, expect, test } from 'vitest'
import { healthLines } from './health-status.js'

const st = (over = {}) => ({ on: true, write: 'on', exported: 0, waiting: 0, skipped: 0, error: null, ...over })

describe('healthLines', () => {
  test('off says so', () => {
    expect(healthLines(st({ on: false }))).toEqual(['Off. Your workouts are not sent to Apple Health.'])
  })
  test('off keeps a failed remove visible', () => {
    expect(healthLines(st({ on: false, error: 'locked' }))).toEqual([
      'Off. Your workouts are not sent to Apple Health.',
      'Last try: locked',
    ])
  })
  test('on with write on', () => {
    expect(healthLines(st({ exported: 3 }))).toEqual(['On. Finished workouts go to Apple Health.', '3 workouts in Health'])
    expect(healthLines(st({ exported: 1 }))[1]).toBe('1 workout in Health')
    expect(healthLines(st())[1]).toBe('0 workouts in Health')
  })
  test('write unknown reads like on', () => {
    expect(healthLines(st({ write: 'unknown' }))[0]).toBe('On. Finished workouts go to Apple Health.')
  })
  test('waiting, error and skipped lines', () => {
    expect(healthLines(st({ exported: 2, waiting: 2, error: 'boom', skipped: 4 }))).toEqual([
      'On. Finished workouts go to Apple Health.',
      '2 workouts in Health',
      '2 waiting',
      'Last try: boom',
      '4 skipped (no start or end time)',
    ])
    expect(healthLines(st({ waiting: 1 }))).toContain('1 waiting')
  })
  test('write off replaces the first line', () => {
    expect(healthLines(st({ write: 'off', exported: 1 }))).toEqual([
      'On, but writing to Apple Health is turned off. Turn on Workouts in Settings → Health → Data Access & Devices → openGym.',
      '1 workout in Health',
    ])
  })
  test('weights in Health follow the workouts line, only when there are some', () => {
    expect(healthLines(st({ exported: 2, weighInsInHealth: 3 }))).toEqual([
      'On. Finished workouts go to Apple Health.',
      '2 workouts in Health',
      '3 weights in Health',
    ])
    expect(healthLines(st({ weighInsInHealth: 1 }))[2]).toBe('1 weight in Health')
    expect(healthLines(st({ weighInsInHealth: 0 }))).toHaveLength(2)
    expect(healthLines(st({ on: false, weighInsInHealth: 2 }))).toEqual(['Off. Your workouts are not sent to Apple Health.'])
  })
})
