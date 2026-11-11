import { describe, expect, test } from 'vitest'
import { equipment, exercises } from '../shared/training.js'
import { customDelete, customDraft, customFormEdit, customUsage, muscleSeed } from './custom-ex-edit.js'

const CATALOGUE_NAME = 'barbell bench press'

const input = (over = {}) => ({
  id: 'c1',
  n: 'My Lift',
  bp: 'chest',
  eq: 'barbell',
  primaries: ['chest'],
  secondaries: [],
  desc: '',
  url: '',
  media: null,
  tg: 'chest',
  ...over,
})

const empty = () => ({ customEx: [], routines: [], workouts: [] })

const snap = value => JSON.parse(JSON.stringify(value))

describe('customDraft', () => {
  test('blank name', () => {
    expect(customDraft(empty(), input({ n: '   ' }))).toEqual({ error: 'Give it a name.' })
    expect(customDraft(empty(), input({ n: '' }))).toEqual({ error: 'Give it a name.' })
  })

  test('long name', () => {
    expect(customDraft(empty(), input({ n: 'a'.repeat(80) })).n).toBe('a'.repeat(80))
    // 82 characters before trim, 80 after. A check on the raw string would refuse this.
    expect(customDraft(empty(), input({ n: '  ' + 'c'.repeat(80) })).n).toBe('c'.repeat(80))
    expect(customDraft(empty(), input({ n: ' ' + 'b'.repeat(81) }))).toEqual({ error: 'Keep the name to 80 characters.' })
  })

  test('missing body part', () => {
    expect(customDraft(empty(), input({ bp: '' }))).toEqual({ error: 'Pick a body part.' })
    expect(customDraft(empty(), input({ bp: 'not-a-part' }))).toEqual({ error: 'Pick a body part.' })
  })

  test('missing equipment', () => {
    expect(customDraft(empty(), input({ eq: '' }))).toEqual({ error: 'Pick equipment.' })
  })

  test('unknown equipment rejected', () => {
    expect(equipment.ALL_EQUIPMENT).not.toContain('spring-stick')
    const stored = { id: 'c1', n: 'My Lift', eq: 'barbell' }
    expect(customDraft(empty(), input({ eq: 'spring-stick' }), stored)).toEqual({ error: 'Pick equipment.' })
    expect(customDraft(empty(), input({ eq: 'other-kit' }))).toEqual({ error: 'Pick equipment.' })
  })

  test('stored unknown equipment kept', () => {
    const stored = { id: 'c1', n: 'Old Name', bp: 'back', eq: 'spring-stick', custom: true }
    const result = customDraft(empty(), input({ n: 'Renamed Lift', eq: 'spring-stick' }), stored)
    expect(result.eq).toBe('spring-stick')
    expect(result.error).toBeUndefined()
    const switched = customDraft(empty(), input({ n: 'Renamed Lift', eq: 'barbell' }), stored)
    expect(switched.eq).toBe('barbell')
    expect(switched.n).toBe('Renamed Lift')
  })

  test('duplicate on create', () => {
    const state = { customEx: [{ id: 'c9', n: 'Trap Bar Deadlift' }], routines: [], workouts: [] }
    expect(customDraft(state, input({ id: 'c-new', n: '  trap bar deadlift ' }))).toEqual({
      error: '\u201cTrap Bar Deadlift\u201d already exists',
    })
  })

  test('same name on edit of itself allowed', () => {
    const stored = { id: 'c9', n: CATALOGUE_NAME, bp: 'chest', eq: 'barbell', custom: true }
    const state = { customEx: [stored], routines: [], workouts: [] }
    const result = customDraft(state, input({ id: 'c9', n: '  BARBELL BENCH PRESS  ' }), stored)
    expect(result.n).toBe('BARBELL BENCH PRESS')
    expect(result.error).toBeUndefined()
    expect(exercises.allExercises({}).some(e => e.n === CATALOGUE_NAME && e.id !== 'c9')).toBe(true)
  })

  test('rename onto a catalogue name refused', () => {
    const stored = { id: 'c9', n: 'My Lift', bp: 'chest', eq: 'barbell', custom: true }
    const state = { customEx: [stored], routines: [], workouts: [] }
    expect(customDraft(state, input({ id: 'c9', n: '  barbell bench press ' }), stored)).toEqual({
      error: '\u201cbarbell bench press\u201d already exists',
    })
  })

  test('description sliced', () => {
    const result = customDraft(empty(), input({ desc: '  ' + 'x'.repeat(1002) + '  ' }))
    expect(result.desc).toBe('x'.repeat(1000))
    expect(customDraft(empty(), input({ desc: '   ' })).desc).toBe('')
  })

  test('empty link omits url', () => {
    const stored = { id: 'c1', n: 'My Lift', bp: 'chest', url: 'https://example.com/old', custom: true }
    const result = customDraft(empty(), input({ url: '   ' }), stored)
    expect(result.n).toBe('My Lift')
    expect(result.id).toBe('c1')
    expect(result.bp).toBe('chest')
    expect(result.error).toBeUndefined()
    expect(result).not.toHaveProperty('url')
  })

  test('bad link', () => {
    expect(customDraft(empty(), input({ url: 'not a url' }))).toEqual({ error: 'That link is not a web address.' })
  })

  test('good link cleaned', () => {
    const result = customDraft(empty(), input({ url: '  example.com  ' }))
    expect(result.url).toBe('https://example.com/')
  })

  test('cardio forces the cardiovascular primary and ignores picked primaries', () => {
    const result = customDraft(empty(), input({
      bp: 'cardio',
      primaries: ['chest', 'biceps'],
      tg: 'chest',
    }))
    expect(result.primaries).toEqual(['cardiovascular system'])
    expect(result.muscleGroups[0]).toBe('cardiovascular system')
    expect(result.tg).toBe('cardiovascular system')
  })

  test('a secondary that is also primary is dropped', () => {
    const result = customDraft(empty(), input({
      primaries: ['chest', 'biceps'],
      secondaries: ['biceps', 'triceps', 4, null],
    }))
    expect(result.secondaries).toEqual(['triceps'])
    expect(result.sm).toEqual(['triceps'])
    expect(result.muscleGroups).toEqual(['chest', 'biceps', 'triceps'])
  })

  test('muscle order is the map order', () => {
    const result = customDraft(empty(), input({
      primaries: ['calves', 1, 'biceps', 'chest'],
      secondaries: ['tibialis', 'abs'],
      tg: 'chest',
    }))
    expect(result.primaries).toEqual(['chest', 'biceps', 'calves'])
    expect(result.secondaries).toEqual(['abs', 'tibialis'])
    expect(result.muscleGroups).toEqual(['chest', 'biceps', 'calves', 'abs', 'tibialis'])
  })

  test('tg kept when still a primary', () => {
    const result = customDraft(empty(), input({
      primaries: ['calves', 'chest'],
      tg: 'calves',
    }), { id: 'c1', n: 'Old', tg: 'chest' })
    expect(result.primaries).toEqual(['chest', 'calves'])
    expect(result.tg).toBe('calves')
  })

  test('tg falls back', () => {
    const storedTg = customDraft(empty(), input({
      primaries: ['calves', 'chest'],
      tg: 'forearm',
    }), { id: 'c1', n: 'Old', tg: 'calves' })
    expect(storedTg.tg).toBe('calves')

    const first = customDraft(empty(), input({
      primaries: ['calves', 'chest'],
      tg: 'forearm',
    }), { id: 'c1', n: 'Old', tg: 'forearm' })
    expect(first.tg).toBe('chest')

    const none = customDraft(empty(), input({ primaries: [], secondaries: ['abs'], tg: 'abs' }))
    expect(none.tg).toBe('')
    expect(none.primaries).toEqual([])
  })

  test('media object kept', () => {
    const media = { kind: 'image', hash: 'abc' }
    const result = customDraft(empty(), input({ media }))
    expect(result.media).toBe(media)
  })

  test('media omitted when input.media is null', () => {
    const stored = { id: 'c1', n: 'My Lift', bp: 'chest', media: { kind: 'image', hash: 'old' }, custom: true }
    const result = customDraft(empty(), input({ media: null }), stored)
    expect(result.n).toBe('My Lift')
    expect(result.id).toBe('c1')
    expect(result.bp).toBe('chest')
    expect(result.error).toBeUndefined()
    expect(result).not.toHaveProperty('media')
  })

  test('an unknown key on stored survives', () => {
    const stored = { id: 'c1', n: 'Old', vendorNote: 'hevy', custom: true }
    const result = customDraft(empty(), input({ n: 'My Lift' }), stored)
    expect(result.vendorNote).toBe('hevy')
  })

  test('stamps on stored are not on the result', () => {
    const stored = {
      id: 'c1', n: 'Old', custom: true,
      _ts: 9, _f: { n: 1 }, _u: 'dev', edited: true, trainingMetadata: { role: 'press' },
    }
    const result = customDraft(empty(), input(), stored)
    expect(result).not.toHaveProperty('_ts')
    expect(result).not.toHaveProperty('_f')
    expect(result).not.toHaveProperty('_u')
    expect(result).not.toHaveProperty('edited')
    expect(result).not.toHaveProperty('trainingMetadata')
    expect(result.custom).toBe(true)
  })

  test('state and stored are not mutated', () => {
    const state = { customEx: [{ id: 'c9', n: 'Other Lift' }], routines: [{ id: 'r', ex: [] }], workouts: [] }
    const stored = {
      id: 'c1', n: 'Old', bp: 'back', eq: 'dumbbell', url: 'https://old.example/',
      media: { hash: 'm' }, primaries: ['chest'], _ts: 1, vendorNote: 'k', custom: true,
    }
    const fields = input({ primaries: ['calves', 'chest'], url: 'example.com' })
    const stateBefore = snap(state)
    const storedBefore = snap(stored)
    const fieldsBefore = snap(fields)
    customDraft(state, fields, stored)
    expect(state).toEqual(stateBefore)
    expect(stored).toEqual(storedBefore)
    expect(fields).toEqual(fieldsBefore)
  })

  test('a create without stored writes only its own fields', () => {
    const result = customDraft(empty(), input({ id: '' }))
    expect(result).toEqual({
      id: expect.stringMatching(/^c[0-9a-z]+$/),
      n: 'My Lift',
      bp: 'chest',
      eq: 'barbell',
      primaries: ['chest'],
      secondaries: [],
      sm: [],
      muscleGroups: ['chest'],
      tg: 'chest',
      desc: '',
      custom: true,
    })
  })

  test('id prefers input, then stored', () => {
    expect(customDraft(empty(), input({ id: 'c-in' })).id).toBe('c-in')
    expect(customDraft(empty(), input({ id: '' }), { id: 'c-stored', n: 'Old' }).id).toBe('c-stored')
  })
})

describe('customUsage', () => {
  const state = {
    routines: [
      null,
      { id: 'r1', ex: [{ id: 'c1' }, { id: 'c1' }, { id: 'other' }] },
      { id: 'r2', ex: [{ id: 'other' }] },
      { id: 'r3' },
      { id: 'r4', ex: null },
    ],
    workouts: [
      null,
      { entries: [{ id: 'c1' }, { id: 'c1' }] },
      { entries: [{ id: 'c1' }] },
      { entries: [{ id: 'nope' }] },
    ],
  }

  test('counts routines and workouts not slots', () => {
    expect(customUsage(state, 'c1', null)).toEqual({ routines: 1, workouts: 2, open: false })
  })

  test('open session', () => {
    expect(customUsage(state, 'c1', ['nope', 'c1']).open).toBe(true)
    expect(customUsage(state, 'c1', [{ id: 'nope' }, { id: 'c1' }]).open).toBe(true)
    expect(customUsage(state, 'c1', [{ id: 'nope' }]).open).toBe(false)
    expect(customUsage(empty(), 'c1', 'c1').open).toBe(false)
  })
})

describe('muscleSeed', () => {
  test('legacy tg and sm fill the chips when primaries were never stored', () => {
    const stored = { id: 'c1', n: 'Old Curl', bp: 'chest', eq: 'dumbbell', custom: true, tg: 'biceps', sm: ['forearm'] }
    expect(muscleSeed(stored)).toEqual({ primaries: ['biceps'], secondaries: ['forearm'] })
    const draft = customDraft(empty(), input({
      id: 'c1', n: 'New Curl', bp: 'chest', eq: 'dumbbell', tg: stored.tg, ...muscleSeed(stored),
    }), stored)
    expect(draft.n).toBe('New Curl')
    expect(draft.primaries).toEqual(['biceps'])
    expect(draft.secondaries).toEqual(['forearm'])
    expect(draft.tg).toBe('biceps')
    expect(draft.sm).toEqual(['forearm'])
    expect(draft.muscleGroups).toEqual(['biceps', 'forearm'])
  })

  test('a muscleGroups list is split the same way, and a listed primary is not replaced by tg', () => {
    expect(muscleSeed({ muscleGroups: ['upper-back', 'biceps'] })).toEqual({ primaries: ['upper-back'], secondaries: ['biceps'] })
    expect(muscleSeed({ primaries: ['chest'], secondaries: [], tg: 'biceps' })).toEqual({ primaries: ['chest'], secondaries: [] })
    expect(muscleSeed({ bp: 'chest', n: 'Plain' })).toEqual({ primaries: [], secondaries: [] })
  })

  test('cardio without primaries seeds the cardiovascular system', () => {
    expect(muscleSeed({ bp: 'cardio', tg: 'chest' })).toEqual({
      primaries: ['cardiovascular system'],
      secondaries: [],
    })
  })
})

describe('customFormEdit', () => {
  test('an edit keeps the stamp the form opened on when the row later carries a newer one', () => {
    const opened = {
      id: 'c1', n: 'Curl', bp: 'chest', eq: 'barbell', custom: true, _ts: 3, media: { hash: 'h' }, note: 'keep',
    }
    const refreshed = { ...opened, n: 'Web curl', _ts: 9 }
    const edit = customFormEdit({
      editing: true,
      id: 'c1',
      baseTs: opened._ts,
      stored: opened,
      state: { customEx: [refreshed], routines: [], workouts: [] },
      input: input({ id: 'c1', n: 'Curl', desc: 'note' }),
    })
    expect(edit.baseTs).toBe(3)
    expect(edit.baseTs).not.toBe(refreshed._ts)
    expect(edit.value.n).toBe('Curl')
    expect(edit.value.desc).toBe('note')
    expect(edit.value.media).toEqual({ hash: 'h' })
    expect(edit.value.note).toBe('keep')
    expect(edit.value._ts).toBeUndefined()
  })
})

describe('customDelete', () => {
  const used = {
    routines: [
      null,
      { ex: [{ id: 'c1' }, { id: 'c1' }] },
    ],
    workouts: [
      { entries: [{ id: 'c1' }] },
      { entries: [{ id: 'c1' }, { id: 'other' }] },
    ],
  }

  test('delete refused with the exact sentences', () => {
    expect(customDelete(used, 'c1', ['c1'])).toEqual({ error: 'Finish your current workout first.' })
    expect(customDelete(used, 'c1', [{ id: 'c1' }])).toEqual({ error: 'Finish your current workout first.' })
    expect(customDelete(empty(), 'c1', ['c1'])).toEqual({ error: 'Finish your current workout first.' })
    expect(customDelete(used, 'c1', [])).toEqual({
      error: 'In 1 routine and 2 workouts. Remove it from the routines first; it stays in your history.',
    })
    expect(customDelete({ routines: [{ ex: [{ id: 'c1' }] }], workouts: [] }, 'c1', [])).toEqual({
      error: 'In 1 routine and 0 workouts. Remove it from the routines first; it stays in your history.',
    })
    expect(customDelete({ routines: [], workouts: [{ entries: [{ id: 'c1' }] }] }, 'c1', [])).toEqual({
      error: 'In 0 routines and 1 workout. Remove it from the routines first; it stays in your history.',
    })
  })

  test('delete of an unused id returns the marker', () => {
    expect(customDelete({ routines: [null], workouts: [null] }, 'missing', undefined)).toEqual({ value: { deleted: true } })
  })
})
