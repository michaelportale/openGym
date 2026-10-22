import { describe, expect, it } from 'vitest'
import { EXIDX } from './exercises.js'
import * as similar from './similar-exercises.js'

const exercise = { id: 'press', eq: 'body weight', tg: 'pectorals', trainingMetadata: { role: 'horizontal-press', primary: ['chest'], secondary: ['triceps'] } }
const candidate = (id, role = 'horizontal-press', primary = ['chest'], eq = 'body weight') => ({ id, eq, tg: 'pectorals', trainingMetadata: { role, primary, secondary: [] } })
const rank = args => {
  expect(similar.rankReplacements).toBeTypeOf('function')
  return similar.rankReplacements({ exercise, ...args })
}

describe('explainable replacements', () => {
  it('prefers a press to a frequently logged fly and warns that the fly has a different role', () => {
    const fly = candidate('fly', 'chest-isolation')
    const result = rank({ candidates: [fly, candidate('other-press'), exercise], workouts: [{ entries: [{ id: 'fly', sets: [{ done: true }] }] }] })
    expect(result.map(r => r.exercise.id)).toEqual(['other-press', 'fly'])
    expect(result[0]).toMatchObject({ tier: 'same-role', reasons: ['Same role and primary target'] })
    expect(result[1].tier).toBe('same-muscle')
    expect(result[1].reasons).toContain('Same muscle, different role')
  })
  it('counts completed-session familiarity once per session, ignoring planned, empty and warm-up-only work', () => {
    const result = rank({ candidates: [candidate('a'), candidate('b'), candidate('c')], workouts: [
      { entries: [{ id: 'b', sets: [{ done: true }, { done: true }] }, { id: 'b', sets: [{ done: true }] }, { id: 'c', sets: [{ done: false }] }] },
      { entries: [{ id: 'a', sets: [{ done: true }] }, { id: 'c', sets: [{ done: true, warmup: true }] }] },
      { entries: [{ id: 'a', sets: [{ done: true }] }] },
    ] })
    expect(result.map(r => r.exercise.id)).toEqual(['a', 'b', 'c'])
    expect(result[0].reasons).toContain('Used in completed workouts')
    expect(result[2].reasons).not.toContain('Used in completed workouts')
  })
  it('uses stable ids for ties and related verified roles before same-muscle fallbacks', () => {
    const result = rank({ candidates: [candidate('z'), candidate('related', 'vertical-press'), candidate('fly', 'chest-isolation'), candidate('a')] })
    expect(result.map(r => r.exercise.id)).toEqual(['a', 'z', 'related', 'fly'])
    expect(result[2]).toMatchObject({ tier: 'related-role', reasons: ['Related role and primary target'] })
  })
  it('excludes occupied stations but keeps an alternative station for the same exercise', () => {
    const machine = candidate('machine', 'horizontal-press', ['chest'], 'leverage machine')
    const second = candidate('second', 'horizontal-press', ['chest'], 'leverage machine')
    const profile = { equipment: [], accV: 1, stations: [{ id: 'occupied', exerciseIds: ['machine', 'second'] }, { id: 'free', exerciseIds: ['second'] }] }
    expect(rank({ candidates: [machine, second], profile, excludedStationIds: ['occupied'] }).map(r => r.exercise.id)).toEqual(['second'])
  })
  it('keeps unknown roles below verified matches without claiming equivalence', () => {
    const unknown = { id: 'unknown', eq: 'body weight', tg: 'pectorals', primary: ['chest'] }
    const result = rank({ candidates: [unknown, candidate('fly', 'chest-isolation')] })
    expect(result.map(r => r.exercise.id)).toEqual(['fly', 'unknown'])
    expect(result[1].tier).toBe('unknown')
    expect(result[1].reasons).toContain('Training metadata unverified')
    expect(rank({ exercise: { id: 'source', tg: 'pectorals' }, candidates: [candidate('a')] })[0].tier).toBe('unknown')
  })
  it('uses explicit metadata overrides and does not return unrelated muscles', () => {
    const result = rank({ candidates: [{ id: 'override', tg: 'quads', eq: 'body weight' }, candidate('curl', 'elbow-flexion', ['biceps'])], metadata: { override: { role: 'horizontal-press', primary: ['chest'], secondary: [] } } })
    expect(result.map(r => r.exercise.id)).toEqual(['override'])
    expect(result[0].tier).toBe('same-role')
  })
})

it('labels original catalogue flies as chest alternatives rather than equivalent presses', () => {
  const result = rank({ exercise: EXIDX['0025'], candidates: [EXIDX['0308'], EXIDX['1030'], EXIDX['0289']] })
  expect(result.map(r => [r.exercise.id, r.tier])).toEqual([['0289', 'same-role'], ['0308', 'same-muscle'], ['1030', 'same-muscle']])
})
