import { describe, it, expect } from 'vitest'
import { exercises } from '../shared/training.js'
import { findExercise, exerciseDetail } from './detail-view.js'

const CREDIT = 'Exercise media © Aliaksandr Makatserchyk, Gym visual, gymvisual.com. Media licensed for use in openGym only; see NOTICE.md'
const all = Object.values(exercises.EXIDX)
const paired = all.find(e => e.fv && e.img && e.gif)
const single = all.find(e => !e.fv && !e.mv && e.img && e.gif && Array.isArray(e.sm) && e.sm.length)
// Aliases are non-enumerable keys of EXIDX.
const enumerable = new Set(Object.keys(exercises.EXIDX))
const aliasId = Object.getOwnPropertyNames(exercises.EXIDX).find(k => !enumerable.has(k) && exercises.canonicalExId(k) !== k)
const custom = { id: 'c1', n: 'my curl', bp: 'upper arms', tg: 'biceps', eq: 'dumbbell', cat: 'strength', sm: [], custom: true }

describe('findExercise', () => {
  it('finds a built-in by id', () => {
    expect(findExercise({}, single.id)).toBe(single)
  })
  it('finds a built-in by alias', () => {
    expect(aliasId).toBeTruthy()
    expect(findExercise({}, aliasId).id).toBe(exercises.canonicalExId(aliasId))
  })
  it('finds a custom by id', () => {
    expect(findExercise({ customEx: [custom] }, 'c1')).toBe(custom)
  })
  it('returns null for an unknown id and for a custom no longer stored', () => {
    expect(findExercise({}, 'nope-zzz')).toBeNull()
    expect(findExercise({ customEx: [] }, 'c1')).toBeNull()
  })
})

describe('exerciseDetail', () => {
  const server = 'https://gym.example'
  it('builds tags in order without empties', () => {
    const d = exerciseDetail({ state: {}, id: single.id, server })
    expect(d.tags).toEqual([single.bp, single.tg, single.eq, single.cat, ...single.sm].filter(Boolean))
    const c = exerciseDetail({ state: { customEx: [{ ...custom, eq: '', cat: '' }] }, id: 'c1', server })
    expect(c.tags).toEqual(['upper arms', 'biceps'])
  })
  it('carries id, name, custom and the credit', () => {
    const d = exerciseDetail({ state: {}, id: single.id, server })
    expect(d).toMatchObject({ id: single.id, name: single.n.charAt(0).toUpperCase() + single.n.slice(1), custom: false, credit: CREDIT })
  })
  it('builds exact media URLs with or without a trailing slash', () => {
    const fig = exercises.figureOf({})
    const still = exercises.imgSrc(single, fig)
    const clip = exercises.gifSrc(single, fig)
    for (const s of [server, server + '/']) {
      const d = exerciseDetail({ state: {}, id: single.id, server: s })
      expect(d.media).toEqual({ still: `https://gym.example/${still}`, clip: `https://gym.example/${clip}` })
    }
    expect(exerciseDetail({ state: {}, id: single.id, server }).media.still).toMatch(/\/exercise-media\/still\/.+\.webp$/)
  })
  it('uses the female drawing when exFigure is female and fv exists', () => {
    const d = exerciseDetail({ state: { exFigure: 'female' }, id: paired.id, server })
    expect(d.media.still).toBe(`https://gym.example/exercise-media/still/${paired.fv}.webp`)
    expect(d.media.clip).toBe(`https://gym.example/exercise-media/clip/${paired.fv}.mp4`)
    const m = exerciseDetail({ state: { exFigure: 'male' }, id: paired.id, server })
    expect(m.media.still).not.toContain(paired.fv)
  })
  it('has no media without a server, with animations off, or for a custom', () => {
    expect(exerciseDetail({ state: {}, id: single.id, server: null }).media).toBeNull()
    expect(exerciseDetail({ state: { gifSize: 'off' }, id: single.id, server }).media).toBeNull()
    const c = exerciseDetail({ state: { customEx: [custom] }, id: 'c1', server })
    expect(c.custom).toBe(true)
    expect(c.media).toBeNull()
  })
  it('treats a stored custom without the custom flag as custom, with no media', () => {
    const flagless = { id: 'c2', n: 'flagless lift', bp: 'chest', tg: 'chest', eq: 'barbell', sm: [] }
    const d = exerciseDetail({ state: { customEx: [flagless] }, id: 'c2', server })
    expect(d.custom).toBe(true)
    expect(d.media).toBeNull()
  })
  it('is null when the exercise is gone', () => {
    expect(exerciseDetail({ state: {}, id: 'nope-zzz', server })).toBeNull()
    expect(exerciseDetail({ state: { customEx: [] }, id: 'c1', server })).toBeNull()
  })
  it('fills best and last from workouts', () => {
    const id = single.id
    const state = { workouts: [
      { d: '2026-11-02', entries: [{ id, sets: [{ done: true, w: 100, r: 5 }] }] },
      { d: '2026-11-09', entries: [{ id, sets: [{ done: true, w: 95, r: 8 }, { done: true, w: 95, r: 7 }] }] },
    ] }
    const d = exerciseDetail({ state, id, server, now: Date.UTC(2026, 10, 9, 12) })
    expect(d.best).toBe('Best: 100 lb')
    expect(d.last).toBe('Last time: Nov 9 · 95 lb × 8')
    // another year keeps its year
    expect(exerciseDetail({ state, id, server, now: Date.UTC(2027, 0, 9, 12) }).last).toBe('Last time: Nov 9, 2026 · 95 lb × 8')
  })
  it('is null for best and last with no history', () => {
    expect(exerciseDetail({ state: { workouts: [] }, id: single.id, server })).toMatchObject({ best: null, last: null })
    expect(exerciseDetail({ state: {}, id: single.id, server })).toMatchObject({ best: null, last: null })
    expect(exerciseDetail({ state: { workouts: [{ d: '2026-01-01' }] }, id: single.id, server })).toMatchObject({ best: null, last: null })
  })
  it('gives only the date when the first set has no load', () => {
    const id = single.id
    const state = { workouts: [{ d: '2026-01-05', entries: [{ id, sets: [{ done: true, w: 0, r: 12 }] }] }] }
    expect(exerciseDetail({ state, id, server, now: Date.UTC(2026, 10, 9, 12) }).last).toBe('Last time: Jan 5')
  })
})

describe('secondary-muscle tags', () => {
  it('a custom whose sm is a string gives one tag, not letters', () => {
    const odd = { id: 'c3', n: 'odd', bp: 'chest', tg: 'chest', eq: 'barbell', sm: 'triceps', custom: true }
    const d = exerciseDetail({ state: { customEx: [odd] }, id: 'c3', server: null })
    expect(d.tags).toContain('triceps')
    expect(d.tags).not.toContain('t')
  })
})
