import { describe, expect, test } from 'vitest'
import { applySlotForm, formRanged, moveSlot, policyChoices, slotForm, stepInvalid, swapSlot } from './slot-edit.js'
import { STEP_INVALID, sheetView, withProg } from './plan-view.js'

const routine = (ex, extra = {}) => ({ id: 'r1', name: 'Push', ex, ...extra })
const bench = { id: 'bench', sets: 3, reps: 10, weight: 60, mode: 'reps' }
const apply = (slot, patch, r = routine([slot])) => applySlotForm(slot, { ...slotForm(slot, r), ...patch }, r)

describe('slotForm', () => {
  test('reads a reps slot', () => {
    expect(slotForm({ ...bench, prog: 'linear' }, routine([bench]))).toMatchObject({
      mode: 'reps', sets: 3, reps: 10, prog: 'linear', ranged: false, perSide: false, pyramid: false,
    })
  })
  test('prog is "" when the slot follows the routine', () => {
    expect(slotForm(bench, routine([bench])).prog).toBe('')
  })
  test('sheets.jsx:1851 a slot on a range policy opens normalised (repsMin filled)', () => {
    const f = slotForm({ ...bench, prog: 'double' }, routine([bench]))
    expect(f).toMatchObject({ ranged: true, reps: 10, repsMin: 8 })
  })
  test('per side comes from the slot', () => {
    expect(slotForm({ ...bench, side: true }, routine([bench])).perSide).toBe(true)
  })
  test('a pyramid slot reports pyramid', () => {
    expect(slotForm({ ...bench, pyramid: [10, 8, 6] }, routine([bench])).pyramid).toBe(true)
  })
  test('time and cardio forms carry sec and min', () => {
    expect(slotForm({ id: 'plank', mode: 'time', sets: 3, sec: 60 }, routine([])).sec).toBe(60)
    expect(slotForm({ id: 'run', mode: 'cardio', sets: 1, min: 30 }, routine([])).min).toBe(30)
  })
})

describe('formRanged (sheets.jsx:1740 climbsRange of the draft policy)', () => {
  test('double and triple climb a range, others do not', () => {
    const r = routine([bench])
    expect(formRanged({ prog: 'double' }, bench, r)).toBe(true)
    expect(formRanged({ prog: 'triple' }, bench, r)).toBe(true)
    expect(formRanged({ prog: 'linear' }, bench, r)).toBe(false)
    expect(formRanged({ prog: 'off' }, bench, r)).toBe(false)
  })
  test("'' follows the routine's rule", () => {
    expect(formRanged({ prog: '' }, bench, routine([bench], { prog: 'double' }))).toBe(true)
    expect(formRanged({ prog: '' }, bench, routine([bench]))).toBe(false)
  })
  test('the draft wins over the slot own prog', () => {
    expect(formRanged({ prog: 'linear' }, { ...bench, prog: 'double' }, routine([bench]))).toBe(false)
  })
  test('time mode never climbs a range', () => {
    expect(formRanged({ prog: 'double' }, { id: 'plank', mode: 'time' }, routine([]))).toBe(false)
  })
})

describe('applySlotForm (sheets.jsx:1875 save)', () => {
  test('sets are rounded, floored at 1, blank takes the default 3 (sheets.jsx:1876)', () => {
    expect(apply(bench, { sets: -2 }).sets).toBe(1)
    expect(apply(bench, { sets: '4.4' }).sets).toBe(4)
    expect(apply(bench, { sets: 0 }).sets).toBe(3)
    expect(apply(bench, { sets: '' }).sets).toBe(3)
  })
  test('reps: strings are rounded, blank takes 10', () => {
    expect(apply(bench, { reps: '12' }).reps).toBe(12)
    expect(apply(bench, { reps: '' }).reps).toBe(10)
    expect(apply(bench, { reps: 0 }).reps).toBe(10)
  })
  test('per-side reps are stored even: 15 becomes 16', () => {
    expect(apply({ ...bench, side: true }, { reps: 15 }).reps).toBe(16)
  })
  test('double with reps 10 and no repsMin writes repsMin 8', () => {
    const out = apply(bench, { prog: 'double', repsMin: undefined })
    expect(out).toMatchObject({ prog: 'double', reps: 10, repsMin: 8 })
  })
  test('a range whose floor reaches the top lifts the top (normalizeRepRange)', () => {
    expect(apply(bench, { prog: 'double', reps: 8, repsMin: 8 })).toMatchObject({ reps: 9, repsMin: 8 })
  })
  test('per-side range stays even', () => {
    expect(apply({ ...bench, side: true }, { prog: 'double', reps: 11, repsMin: 5 })).toMatchObject({ reps: 12, repsMin: 6 })
  })
  test('switching to linear removes repsMin', () => {
    const slot = { ...bench, prog: 'double', repsMin: 8 }
    const out = apply(slot, { prog: 'linear' })
    expect(out.prog).toBe('linear')
    expect('repsMin' in out).toBe(false)
  })
  test("prog '' removes prog; the routine's rule then applies", () => {
    const out = apply({ ...bench, prog: 'linear' }, { prog: '' })
    expect('prog' in out).toBe(false)
  })
  test("prog '' under a routine on double still writes the range", () => {
    const r = routine([bench], { prog: 'double' })
    expect(apply(bench, { prog: '' }, r)).toMatchObject({ reps: 10, repsMin: 8 })
  })
  test('timed sec 0 becomes 45, floored at 1', () => {
    const plank = { id: 'plank', mode: 'time', sets: 3, sec: 60, weight: 0 }
    expect(apply(plank, { sec: 0 }).sec).toBe(45)
    expect(apply(plank, { sec: '90' }).sec).toBe(90)
    expect(apply(plank, { sec: -5 }).sec).toBe(1)
    expect(apply(plank, { sets: 0 }).sets).toBe(3)
  })
  test('cardio min blank becomes 20 and sets blank becomes 1', () => {
    const run = { id: 'run', mode: 'cardio', sets: 1, min: 30, speed: 8 }
    expect(apply(run, { min: '' }).min).toBe(20)
    expect(apply(run, { sets: '' }).sets).toBe(1)
    expect(apply(run, { min: 45 }).min).toBe(45)
  })
  test('cardio has no prog choice: a prog key is left alone', () => {
    const run = { id: 'run', mode: 'cardio', sets: 1, min: 30, prog: 'off' }
    expect(apply(run, { prog: 'linear' }).prog).toBe('off')
  })
  test('keys the web save would drop survive (ruling 1)', () => {
    const slot = {
      ...bench, dbLoad: 'pair', note: 'pause', pyramidRest: [60], intensifier: { type: 'drop' }, setsMax: 5,
      deloadFactor: 0.8, inc: 5, backoff: true, lastToFailure: true, stationId: 's1', warmupSets: 2, restSec: 90,
      sg: 'a', sgName: 'A', _x: 1,
    }
    const out = apply(slot, { sets: 4, prog: 'double' })
    const { sets: _s, prog: _p, reps: _r, repsMin: _m, ...rest } = out
    const { sets: _s2, reps: _r2, ...expected } = slot
    expect(rest).toEqual(expected)
  })
  test('time slot keeps reps-only keys it carries', () => {
    const plank = { id: 'plank', mode: 'time', sets: 3, sec: 60, reps: 10, repsMin: 8 }
    expect(apply(plank, { sec: 30 })).toMatchObject({ reps: 10, repsMin: 8, sec: 30 })
  })
  test('a pyramid slot keeps sets, reps, repsMin and prog', () => {
    const slot = { ...bench, pyramid: [12, 10, 8], sets: 3, reps: 12, repsMin: 8, prog: 'double' }
    const out = apply(slot, { sets: 9, reps: 1, repsMin: 1, prog: 'linear' })
    expect(out).toEqual(slot)
    expect(out).not.toBe(slot)
  })
  test('never mutates the slot', () => {
    const slot = { ...bench, prog: 'double', repsMin: 8 }
    const before = JSON.stringify(slot)
    apply(slot, { sets: 5, prog: '' })
    expect(JSON.stringify(slot)).toBe(before)
  })
})

// What the web's rule picker (ProgressionFields) and ExConfig's save do beyond sets, reps and the
// rule. The phone shows none of these fields: it sets or raises setsMax, lastToFailure and repsMax
// as the web would, and never removes one.
describe('triple progression\'s set ceiling (sheets.jsx:1774 picker default, :1943 save)', () => {
  test('triple gives a slot with no ceiling above its sets min(10, sets + 2)', () => {
    expect(apply(bench, { prog: 'triple' })).toMatchObject({ prog: 'triple', sets: 3, setsMax: 5 })
    expect(apply(bench, { prog: 'triple', sets: 9 }).setsMax).toBe(10)
  })
  test('a ceiling not above the sets is raised to that default; one above them is kept as it is', () => {
    expect(apply({ ...bench, setsMax: 3 }, { prog: 'triple' }).setsMax).toBe(5)
    expect(apply({ ...bench, setsMax: 6 }, { prog: 'triple' }).setsMax).toBe(6)
    expect(apply({ ...bench, setsMax: 12 }, { prog: 'triple' }).setsMax).toBe(12)
    expect(apply({ ...bench, prog: 'triple', setsMax: 5 }, { sets: 6 }).setsMax).toBe(8)
  })
  test('at 10 sets there is no room above: nothing is written, and a ceiling there is kept, never removed', () => {
    expect('setsMax' in apply(bench, { prog: 'triple', sets: 10 })).toBe(false)
    expect(apply({ ...bench, setsMax: 4 }, { prog: 'triple', sets: 10 }).setsMax).toBe(4)
  })
  test('the rule in force counts: a routine on triple gives one; other rules leave it alone', () => {
    expect(apply(bench, { prog: '' }, routine([bench], { prog: 'triple' })).setsMax).toBe(5)
    expect('setsMax' in apply(bench, { prog: 'double' })).toBe(false)
    expect(apply({ ...bench, setsMax: 2 }, { prog: 'linear' }).setsMax).toBe(2)
    expect('setsMax' in apply({ id: 'plank', mode: 'time', sets: 3, sec: 30 }, { prog: 'time' })).toBe(false)
  })
})

describe('picking Greyskull (sheets.jsx:1771)', () => {
  const r = routine([bench])
  const picked = (slot, prog) => withProg(slotForm(slot, r), prog, slot, r)
  test('turns Last set to failure on, unless the slot already decided it', () => {
    expect(picked(bench, 'greyskull').lastToFailure).toBe(true)
    expect(applySlotForm(bench, picked(bench, 'greyskull'), r)).toMatchObject({ prog: 'greyskull', lastToFailure: true })
    const off = { ...bench, lastToFailure: false }
    expect(applySlotForm(off, picked(off, 'greyskull'), r).lastToFailure).toBe(false)
  })
  test('only the pick does it: a slot on Greyskull edited otherwise, or a rule picked away again, keeps what the slot had', () => {
    const gs = { ...bench, prog: 'greyskull' }
    expect('lastToFailure' in apply(gs, { sets: 4 })).toBe(false)
    expect('lastToFailure' in applySlotForm(bench, withProg(picked(bench, 'greyskull'), 'linear', bench, r), r)).toBe(false)
    expect('lastToFailure' in applySlotForm(bench, picked(bench, ''), routine([bench], { prog: 'greyskull' }))).toBe(false)
  })
})

describe('a bodyweight rep ceiling (sheets.jsx:1945)', () => {
  const dip = { id: 'dip', bodyweight: true, sets: 3, reps: 8, weight: 0, repsMax: 12, mode: 'reps' }
  test('reps above the ceiling raise it to the reps; below it, it is kept', () => {
    expect(apply(dip, { reps: 15 }).repsMax).toBe(15)
    expect(apply(dip, { reps: 10 }).repsMax).toBe(12)
    expect(apply(dip, { prog: 'double', reps: 14, repsMin: 10 }).repsMax).toBe(14)
  })
  test('only bodyweight work with no load and a ceiling', () => {
    expect(apply({ ...dip, weight: 10 }, { reps: 15 }).repsMax).toBe(12)
    expect(apply({ ...dip, bodyweight: false }, { reps: 15 }).repsMax).toBe(12)
    const { repsMax: _none, ...noCeiling } = dip
    expect('repsMax' in apply(noCeiling, { reps: 15 })).toBe(false)
  })
})

describe('policyChoices: triple is not offered for bodyweight work with no load (sheets.jsx:1748)', () => {
  const dip = { id: 'dip', bodyweight: true, sets: 3, reps: 8, weight: 0, mode: 'reps' }
  const values = slot => policyChoices(slot, routine([slot])).map(c => c.value)
  test('left out with no load, offered with some, and kept on a slot already on triple', () => {
    expect(values(dip)).toEqual(['', 'off', 'linear', 'greyskull', 'double'])
    expect(values({ ...dip, weight: 10 })).toContain('triple')
    expect(values({ ...dip, prog: 'triple' })).toContain('triple')
    expect(values({ ...dip, bodyweight: false })).toContain('triple')
  })
})

describe('an invalid Step refuses Save (sheets.jsx:1727 progressionStepOf, :1730 progressionStepIsValid, :1735 backoffOffered, :1863, :1876, :2213)', () => {
  const r = routine([bench])
  const invalid = (slot, prog) => stepInvalid({ ...slotForm(slot, r), prog }, slot, r)
  test('a Step of 0 is fine with no rule, and refused for any rule in force', () => {
    const zero = { ...bench, inc: 0 }
    expect(invalid(zero, 'off')).toBe(false)
    expect(invalid(zero, 'linear')).toBe(true)
    expect(invalid(zero, '')).toBe(true) // follows the routine: linear
    expect(stepInvalid({ ...slotForm(zero, r), prog: '' }, zero, routine([zero], { prog: 'off' }))).toBe(false)
  })
  test('no Step, or a negative one, is the default increment, which is valid', () => {
    expect(invalid(bench, 'linear')).toBe(false)
    expect(invalid({ ...bench, inc: -1 }, 'linear')).toBe(false)
    expect(invalid({ id: 'plank', mode: 'time', sets: 3, sec: 30 }, 'time')).toBe(false)
    expect(invalid({ id: 'plank', mode: 'time', sets: 3, sec: 30, inc: 0 }, 'time')).toBe(true)
  })
  test('back-off sets need a Step even with no rule, where they are offered', () => {
    const backoff = { ...bench, inc: 0, backoff: true }
    expect(invalid(backoff, 'off')).toBe(true)
    expect(invalid({ ...backoff, bodyweight: true }, 'off')).toBe(false)
    expect(invalid({ ...backoff, intensifier: { type: 'restpause' } }, 'off')).toBe(false)
  })
  test('cardio has no rule and no Step to refuse', () => {
    const run = { id: 'run', mode: 'cardio', sets: 1, min: 30, inc: 0 }
    expect(invalid(run, '')).toBe(false)
  })
  test('the sheet shows the web\'s message while the draft is invalid (sheets.jsx:1808)', () => {
    const zero = { ...bench, inc: 0 }
    expect(STEP_INVALID).toBe('Enter a positive step to use this progression rule.')
    expect(sheetView({ ...slotForm(zero, r), prog: 'linear' }, zero, r).invalid).toBe(STEP_INVALID)
    expect(sheetView({ ...slotForm(zero, r), prog: 'off' }, zero, r).invalid).toBeNull()
  })
})

describe('policyChoices', () => {
  test('reps: follow label names the routine rule, then every policy', () => {
    const c = policyChoices(bench, routine([bench]))
    expect(c[0]).toEqual({ value: '', label: 'Follow the routine (Linear progression)' })
    expect(c.slice(1)).toEqual([
      { value: 'off', label: 'No automatic progression' },
      { value: 'linear', label: 'Linear progression' },
      { value: 'greyskull', label: 'Greyskull LP' },
      { value: 'double', label: 'Double progression' },
      { value: 'triple', label: 'Triple progression' },
    ])
  })
  test('the routine prog names the follow label, and the slot own prog does not', () => {
    const c = policyChoices({ ...bench, prog: 'triple' }, routine([bench], { prog: 'greyskull' }))
    expect(c[0].label).toBe('Follow the routine (Greyskull LP)')
  })
  test('time', () => {
    const c = policyChoices({ id: 'plank', mode: 'time' }, routine([]))
    expect(c).toEqual([
      { value: '', label: 'Follow the routine (No automatic progression)' },
      { value: 'off', label: 'No automatic progression' },
      { value: 'time', label: 'Add time' },
    ])
  })
  test('cardio', () => {
    const c = policyChoices({ id: 'run', mode: 'cardio' }, routine([]))
    expect(c).toEqual([
      { value: '', label: 'Follow the routine (No automatic progression)' },
      { value: 'off', label: 'No automatic progression' },
    ])
  })
})

describe('moveSlot (history.moveRoutineEntry)', () => {
  const a = { id: 'a', sets: 3, reps: 5, sg: 's' }
  const b = { id: 'b', sets: 3, reps: 5, sg: 's' }
  const c = { id: 'c', sets: 3, reps: 5 }
  const d = { id: 'd', sets: 3, reps: 5 }

  test('moves a lone exercise past its neighbour', () => {
    const r = routine([c, d])
    const out = moveSlot(r, 0, 1, null)
    expect(out.routine.ex.map(x => x.id)).toEqual(['d', 'c'])
    expect(out.unsafe).toBe(false)
    expect(r.ex.map(x => x.id)).toEqual(['c', 'd'])
  })
  test('inside a superset it swaps members and keeps sg', () => {
    const out = moveSlot(routine([a, b, c]), 0, 1, null)
    expect(out.routine.ex).toEqual([b, a, c])
  })
  test('at a superset edge the member leaves it (sg dropped, position kept) and the other dissolves', () => {
    const out = moveSlot(routine([a, b, c]), 1, 1, null)
    expect(out.routine.ex).toEqual([{ id: 'a', sets: 3, reps: 5 }, { id: 'b', sets: 3, reps: 5 }, c])
  })
  test('returns null where moveRoutineEntry does', () => {
    expect(moveSlot(routine([c, d]), 0, -1, null)).toBeNull()
    expect(moveSlot(routine([c, d]), 1, 1, null)).toBeNull()
    expect(moveSlot(routine([c, d]), 5, 1, null)).toBeNull()
    expect(moveSlot(routine([c, d]), 0, 2, null)).toBeNull()
  })
  test('keeps every other routine key and returns new objects', () => {
    const r = routine([c, d], { emoji: 'x', _ts: 4, _f: { name: 1 } })
    const out = moveSlot(r, 0, 1, null)
    expect(out.routine).toMatchObject({ id: 'r1', name: 'Push', emoji: 'x', _ts: 4, _f: { name: 1 } })
    expect(out.routine).not.toBe(r)
    expect(out.routine.ex[1]).not.toBe(c)
  })
  test('unsafe is putBackChanges against the base: twins the server would pair the other way round', () => {
    const twin1 = { id: 'bench', sets: 3, reps: 5, mode: 'reps', weight: 60, stationId: 'rack-2' }
    const twin2 = { id: 'bench', sets: 3, reps: 10, mode: 'reps', weight: 45 }
    const base = routine([twin1, twin2, { id: 'row', sets: 3, reps: 8 }])
    const out = moveSlot(base, 0, 1, base)
    expect(out.unsafe).toBe(true)
    expect(moveSlot(base, 0, 1, null).unsafe).toBe(false)
    expect(moveSlot(base, 1, 1, base).unsafe).toBe(false)
  })
})

describe('swapSlot (routines.replaceSlotExercise)', () => {
  const slot = { id: 'bench', sets: 4, reps: 8, weight: 60, sg: 's', note: 'pause', restSec: 90 }
  test('keeps sg and note and swaps the id', () => {
    const r = routine([slot, { id: 'row', sets: 3, reps: 8, sg: 's' }])
    const out = swapSlot(r, 0, 'press', null, null)
    expect(out.routine.ex[0]).toMatchObject({ id: 'press', sets: 4, reps: 8, sg: 's', note: 'pause', restSec: 90 })
    expect(out.routine.ex[1]).toEqual(r.ex[1])
    expect(out.unsafe).toBe(false)
  })
  test('does not mutate the input', () => {
    const r = routine([slot])
    const before = JSON.stringify(r)
    swapSlot(r, 0, 'press', null, null)
    expect(JSON.stringify(r)).toBe(before)
  })
  test('null when the id is unchanged or the index is out of range', () => {
    const r = routine([slot])
    expect(swapSlot(r, 0, 'bench', null, null)).toBeNull()
    expect(swapSlot(r, 1, 'press', null, null)).toBeNull()
    expect(swapSlot(r, -1, 'press', null, null)).toBeNull()
  })
  test('hands the routine id to replaceSlotExercise and the state through', () => {
    const state = { workouts: [], routines: [] }
    expect(swapSlot(routine([slot]), 0, 'press', state, null).routine.ex[0].id).toBe('press')
  })
})
