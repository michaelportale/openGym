import { describe, expect, test } from 'vitest'
import {
  duplicateRoutine, newRoutine, renamedRoutine, routineWithDeload, routineWithProg, routineWithSlotAdded,
  routineWithSlotRemoved, routinesMoved,
} from './routine-edit.js'
import { DELOAD_SUBTITLE, DELOAD_TITLE, NAME_BLANK, PAIR_TO_AUTHOR, REFUSED_SUPERSET, REFUSED_TWIN, UNSAFE_EDIT } from './plan-view.js'

const bench = { id: 'bench', sets: 3, reps: 10, weight: 60, mode: 'reps' }
const row = { id: 'row', sets: 3, reps: 10, weight: 40, mode: 'reps' }
const routine = (ex, extra = {}) => ({ id: 'r1', name: 'Push', emoji: 'figureStrength', ex, ...extra })
const frozen = value => JSON.parse(JSON.stringify(value))

describe('newRoutine', () => {
  test('trims the name and starts empty with the default glyph', () => {
    expect(newRoutine('  Legs ')).toMatchObject({ name: 'Legs', emoji: 'figureStrength', ex: [] })
    expect(typeof newRoutine('Legs').id).toBe('string')
  })
  test('a blank name gives null', () => {
    expect(newRoutine('')).toBeNull()
    expect(newRoutine('   ')).toBeNull()
    expect(newRoutine(undefined)).toBeNull()
  })
  test('ids differ', () => {
    expect(newRoutine('A').id).not.toBe(newRoutine('A').id)
  })
})

describe('duplicateRoutine', () => {
  const stamped = routine([{ ...bench, _ts: 1, _f: { sets: 2 }, _u: 'a' }, row], { _ts: 5, _f: { name: 1 }, _u: 'dev' })
  test('strips stamps from the top level and every slot, with a fresh id', () => {
    const copy = duplicateRoutine(stamped)
    expect(copy.id).not.toBe('r1')
    for (const x of [copy, ...copy.ex]) {
      expect(x).not.toHaveProperty('_ts')
      expect(x).not.toHaveProperty('_f')
      expect(x).not.toHaveProperty('_u')
    }
    expect(copy.ex[0]).toMatchObject({ id: 'bench', sets: 3 })
  })
  test('names it (Copy), then (Copy 2), then (Copy 3)', () => {
    const one = duplicateRoutine(routine([]))
    expect(one.name).toBe('Push (Copy)')
    const two = duplicateRoutine(one)
    expect(two.name).toBe('Push (Copy 2)')
    expect(duplicateRoutine(two).name).toBe('Push (Copy 3)')
  })
  test('does not mutate the input', () => {
    const before = frozen(stamped)
    duplicateRoutine(stamped)
    expect(stamped).toEqual(before)
  })
})

describe('renamedRoutine', () => {
  test('trims', () => {
    const r = routine([bench])
    expect(renamedRoutine(r, ' Pull ')).toMatchObject({ name: 'Pull', ex: [bench] })
    expect(r.name).toBe('Push')
  })
  test('blank gives null', () => {
    expect(renamedRoutine(routine([]), '  ')).toBeNull()
  })
})

describe('routineWithSlotAdded', () => {
  test('appends the web quick-add default', () => {
    const r = routine([bench])
    const next = routineWithSlotAdded(r, 'row')
    expect(next.ex).toHaveLength(2)
    expect(next.ex[1]).toMatchObject({ id: 'row', sets: 3, reps: 10, weight: 0, mode: 'reps' })
    expect(r.ex).toHaveLength(1)
  })
  test('the same exercise twice appends', () => {
    const next = routineWithSlotAdded(routineWithSlotAdded(routine([]), 'bench'), 'bench')
    expect(next.ex.map(s => s.id)).toEqual(['bench', 'bench'])
  })
})

describe('routineWithSlotRemoved', () => {
  test('removes a plain slot', () => {
    const r = routine([bench, row])
    const out = routineWithSlotRemoved(r, 0, r)
    expect(out.refused).toBeNull()
    expect(out.routine.ex.map(s => s.id)).toEqual(['row'])
    expect(r.ex).toHaveLength(2)
  })
  test('a superset member is refused', () => {
    const r = routine([{ ...bench, sg: 'A' }, { ...row, sg: 'A' }])
    expect(routineWithSlotRemoved(r, 0, r)).toEqual({ routine: null, refused: 'superset' })
  })
  test('the first copy of a twin is refused, the last is allowed', () => {
    const r = routine([bench, row, { ...bench }])
    expect(routineWithSlotRemoved(r, 0, r)).toEqual({ routine: null, refused: 'twin' })
    const last = routineWithSlotRemoved(r, 2, r)
    expect(last.refused).toBeNull()
    expect(last.routine.ex.map(s => s.id)).toEqual(['bench', 'row'])
  })
  test('refuses when the server would put something back', () => {
    // The stored copy has a key on the routine that the edit loses.
    const base = routine([bench, row], { note: 'keep me' })
    const edit = { ...base }
    delete edit.note
    expect(routineWithSlotRemoved(edit, 0, base)).toEqual({ routine: null, refused: 'unsafe' })
  })
  test('a bad index is refused', () => {
    const r = routine([bench])
    expect(routineWithSlotRemoved(r, 3, r).refused).toBe('unsafe')
    expect(routineWithSlotRemoved(r, -1, r).refused).toBe('unsafe')
  })
  test('does not mutate the input', () => {
    const r = routine([bench, row])
    const before = frozen(r)
    routineWithSlotRemoved(r, 0, r)
    expect(r).toEqual(before)
  })
})

describe('routineWithProg', () => {
  test('writes the rule', () => {
    const r = routine([bench])
    expect(routineWithProg(r, 'double').prog).toBe('double')
    expect(r).not.toHaveProperty('prog')
  })
  test('a rule the routine picker does not offer gives null', () => {
    expect(routineWithProg(routine([]), '')).toBeNull()
    expect(routineWithProg(routine([]), 'nope')).toBeNull()
  })
})

describe('routineWithDeload', () => {
  test('on sets the flag, off deletes the key', () => {
    const on = routineWithDeload(routine([bench]), true)
    expect(on.excludeFromProgression).toBe(true)
    const off = routineWithDeload(on, false)
    expect(off).not.toHaveProperty('excludeFromProgression')
    expect(on.excludeFromProgression).toBe(true)
  })
})

describe('routinesMoved', () => {
  const rs = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  test('moves up and down', () => {
    expect(routinesMoved(rs, 1, -1)).toEqual(['b', 'a', 'c'])
    expect(routinesMoved(rs, 1, 1)).toEqual(['a', 'c', 'b'])
  })
  test('null at an edge or for a bad index', () => {
    expect(routinesMoved(rs, 0, -1)).toBeNull()
    expect(routinesMoved(rs, 2, 1)).toBeNull()
    expect(routinesMoved(rs, 5, -1)).toBeNull()
    expect(routinesMoved(rs, 1, 2)).toBeNull()
  })
})

describe('wording', () => {
  test('the sentences', () => {
    expect(REFUSED_SUPERSET).toBe("It's linked in a superset. Keep it, or delete the whole routine.")
    expect(REFUSED_TWIN).toBe(UNSAFE_EDIT)
    expect(NAME_BLANK).toBe('Enter a name.')
    expect(PAIR_TO_AUTHOR).toBe('Pair with your server to add, delete or reorder routines.')
    expect(DELOAD_TITLE).toBe('Deload routine')
    expect(DELOAD_SUBTITLE).toBe('Its workouts do not count toward progression. They still show in history and statistics.')
  })
})
