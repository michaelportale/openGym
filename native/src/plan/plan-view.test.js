import { describe, expect, test } from 'vitest'
import {
  MISSING_ROUTINE, UNSAFE_EDIT, baseRoutine, draftChanged, editBase, findRoutine, indexOfKey, movedText, noticeLines, planView, routineView, savedRoutine, sheetView, stepForm, withProg,
} from './plan-view.js'
import { slotForm } from './slot-edit.js'

const push = { id: 'a', name: 'Push A', ex: [{ id: 'bench', sets: 3, reps: 10 }, { id: 'ohp', sets: 3, reps: 8 }] }
const pull = { id: 'b', name: 'Pull B', ex: [{ id: 'row', sets: 3, reps: 10 }] }
const legs = { id: 'c', name: 'Legs', ex: [] }

describe('planView: how you train', () => {
  test('rotation: the loop in order, the routine the Workout tab would start marked next', () => {
    const state = { routines: [push, pull, legs], scheduleMode: 'rotation', rotation: { id: 'rot', sequence: ['b', 'gone', 'a'] } }
    expect(planView(state, { nextId: 'a' }).schedule).toEqual({
      kind: 'rotation',
      items: [{ id: 'b', name: 'Pull B', next: false }, { id: 'a', name: 'Push A', next: true }],
    })
  })
  test('rotation: a live queue is the loop, as the web Plan shows it', () => {
    const state = {
      routines: [push, pull, legs],
      rotation: { id: 'rot', sequence: ['a', 'b'] },
      queue: { ids: ['c', 'a', 'c'], since: 0, startsOn: '2026-01-01', rotationId: 'rot' },
    }
    expect(planView(state, { nextId: 'c' }).schedule.items).toEqual([
      { id: 'c', name: 'Legs', next: true }, { id: 'a', name: 'Push A', next: false },
    ])
  })
  test('fixed week: Monday first, Rest for a day with none, a combined day names each routine', () => {
    const state = { routines: [push, pull, legs], week: { 0: ['c'], 1: ['a'], 3: ['a', 'b'], 4: [], 5: 'b', 6: ['gone'] } }
    expect(planView(state, {}).schedule).toEqual({
      kind: 'week',
      days: [
        { label: 'Mon', names: ['Push A'] },
        { label: 'Tue', names: null },
        { label: 'Wed', names: ['Push A', 'Pull B'] },
        { label: 'Thu', names: null },
        { label: 'Fri', names: ['Pull B'] },
        { label: 'Sat', names: null },
        { label: 'Sun', names: ['Legs'] },
      ],
    })
  })
  test('no schedule: nothing planned on any weekday, an empty loop, or no state', () => {
    expect(planView({ routines: [push], week: { 1: [], 2: ['gone'] } }, {}).schedule).toBeNull()
    expect(planView({ routines: [push], scheduleMode: 'rotation', rotation: { id: 'r', sequence: [] } }, { nextId: 'a' }).schedule).toBeNull()
    expect(planView({ routines: [push] }, {}).schedule).toBeNull()
    expect(planView(null, {}).schedule).toBeNull()
  })
})

describe('planView: your routines', () => {
  test('every routine in list order with its exercise count', () => {
    expect(planView({ routines: [push, pull, legs] }, {}).routines).toEqual([
      { id: 'a', name: 'Push A', count: 2 }, { id: 'b', name: 'Pull B', count: 1 }, { id: 'c', name: 'Legs', count: 0 },
    ])
  })
  test('a routine whose ex is not a list reads as 0 exercises; a non-object entry is skipped', () => {
    expect(planView({ routines: [{ id: 'x', name: 'Odd', ex: 'oops' }, null, { id: 'y', name: 'None' }] }, {}).routines).toEqual([
      { id: 'x', name: 'Odd', count: 0 }, { id: 'y', name: 'None', count: 0 },
    ])
  })
})

describe('notices', () => {
  const notices = [
    { rid: 'a', name: 'Push A', kind: 'changed', at: '1' },
    { rid: 'b', name: 'Pull B', kind: 'deleted', at: '2' },
    { rid: 'c', name: 'Legs', kind: 'unsafe', at: '3' },
  ]
  test('the exact text for changed, deleted and unsafe, and a Dismiss label that names the routine', () => {
    expect(noticeLines(notices)).toEqual([
      { rid: 'a', text: "Your change to Push A wasn't sent: it was changed on the web first. This shows the web's version.", dismissLabel: 'Dismiss notice about Push A' },
      { rid: 'b', text: "Your change to Pull B wasn't sent: it was deleted on the web.", dismissLabel: 'Dismiss notice about Pull B' },
      { rid: 'c', text: "Your change to Legs wasn't sent: this move or swap has to be made on the web.", dismissLabel: 'Dismiss notice about Legs' },
    ])
  })
  test('planView carries them in order; none reads as none', () => {
    expect(planView({ routines: [] }, { notices }).notices.map(n => n.rid)).toEqual(['a', 'b', 'c'])
    expect(planView({ routines: [] }, {}).notices).toEqual([])
  })
  test('an empty or blank name reads as this routine', () => {
    expect(noticeLines([{ rid: 'a', name: '', kind: 'changed' }, { rid: 'b', name: '  ', kind: 'deleted' }, { rid: 'c', name: null, kind: 'unsafe' }])).toEqual([
      { rid: 'a', text: "Your change to this routine wasn't sent: it was changed on the web first. This shows the web's version.", dismissLabel: 'Dismiss notice about this routine' },
      { rid: 'b', text: "Your change to this routine wasn't sent: it was deleted on the web.", dismissLabel: 'Dismiss notice about this routine' },
      { rid: 'c', text: "Your change to this routine wasn't sent: this move or swap has to be made on the web.", dismissLabel: 'Dismiss notice about this routine' },
    ])
  })
  test('the sheet and screen sentences', () => {
    expect(UNSAFE_EDIT).toBe('This move or swap has to be made on the web.')
    expect(MISSING_ROUTINE).toBe("This routine isn't in your plan any more.")
  })
})

describe('routineView', () => {
  const names = { bench: { name: 'Barbell bench press' }, ohp: { name: 'Overhead press' }, fly: { name: 'Cable fly' }, dip: { name: 'Dip' } }
  const routine = {
    id: 'a', name: 'Push A', prog: 'double',
    ex: [
      { id: 'bench', sets: 3, reps: 10, weight: 135 },
      { id: 'ohp', sets: 3, reps: 8, sg: 's1' },
      { id: 'fly', sets: 2, reps: 15, sg: 's1' },
      { id: 'dip', sets: 3, reps: 10, sg: 'lone' },
      { id: 'mystery', sets: 3, reps: 10 },
    ],
  }
  test('name, the routine own rule, and one row per exercise with the shared exLine', () => {
    const view = routineView({ routines: [routine] }, 'a', { unit: 'lb', names })
    expect(view.id).toBe('a')
    expect(view.name).toBe('Push A')
    expect(view.progLabel).toBe('Progression: Double progression')
    expect(view.rows[0]).toEqual({ index: 0, key: 'bench#0', id: 'bench', name: 'Barbell bench press', line: '3 × 10 · 135 lb', superset: false, up: false, down: true })
  })
  test('rows are keyed by the slot: its exercise id, and which of that exercise it is for twins', () => {
    const twins = { id: 't', name: 'T', ex: [{ id: 'bench', sets: 3 }, null, { id: 'row', sets: 3 }, { id: 'bench', sets: 2 }] }
    expect(routineView({ routines: [twins] }, 't', { unit: 'lb', names }).rows.map(r => [r.index, r.key])).toEqual([[0, 'bench#0'], [2, 'row#0'], [3, 'bench#1']])
  })
  test('indexOfKey finds a row\'s slot where it is now, and -1 once it is gone', () => {
    const twins = { id: 't', ex: [{ id: 'bench', sets: 3 }, null, { id: 'row', sets: 3 }, { id: 'bench', sets: 2 }] }
    expect(indexOfKey(twins, 'bench#1')).toBe(3)
    expect(indexOfKey(twins, 'row#0')).toBe(2)
    expect(indexOfKey({ ...twins, ex: [twins.ex[2], twins.ex[0]] }, 'row#0')).toBe(0)
    expect(indexOfKey(twins, 'bench#2')).toBe(-1)
    expect(indexOfKey({ id: 't', ex: 'oops' }, 'bench#0')).toBe(-1)
    expect(indexOfKey(null, 'bench#0')).toBe(-1)
  })
  test('movedText: what VoiceOver says after a move', () => {
    expect(movedText('Barbell bench press', 2, 1, 5)).toBe('Barbell bench press moved to 2 of 5')
    expect(movedText('Overhead press', 1, 1, 5)).toBe('Overhead press left the superset, 2 of 5')
  })
  test("each row's Move up and Move down are offered exactly when moveSlot would move it", () => {
    const view = routineView({ routines: [routine] }, 'a', { unit: 'lb', names })
    expect(view.rows.map(r => [r.up, r.down])).toEqual([
      [false, true], // first: nothing above
      [true, true], // superset member: past its partner below, or out of the superset above
      [true, true],
      [true, true],
      [true, false], // last
    ])
    const single = { id: 's', name: 'One', ex: [{ id: 'bench', sets: 3, reps: 10 }] }
    expect(routineView({ routines: [single] }, 's', { unit: 'lb', names }).rows[0]).toMatchObject({ up: false, down: false })
  })
  test('a routine with a non-object slot offers no moves (the shared move reads every slot)', () => {
    const holed = { id: 'h', name: 'Holes', ex: [null, { id: 'bench', sets: 3, reps: 10 }, { id: 'ohp', sets: 3, reps: 8 }] }
    expect(routineView({ routines: [holed] }, 'h', { unit: 'lb', names }).rows.map(r => [r.up, r.down])).toEqual([[false, false], [false, false]])
  })
  test('the routine to show can be given: this screen\'s writes before they are read back', () => {
    const moved = { ...routine, ex: [routine.ex[4], ...routine.ex.slice(0, 4)] }
    const view = routineView({ routines: [routine] }, 'a', { unit: 'lb', names, routine: moved })
    expect(view.rows.map(r => r.id)).toEqual(['mystery', 'bench', 'ohp', 'fly', 'dip'])
  })
  test('an exercise the names map lacks takes its catalogue name (a swap not yet read back)', () => {
    const swapped = { id: 'w', name: 'W', ex: [{ id: '0025', sets: 3, reps: 8 }] }
    expect(routineView({ routines: [swapped] }, 'w', { unit: 'lb', names: {} }).rows[0].name).toBe('Barbell bench press')
  })
  test('linked rows are tagged Superset; a lone leftover sg is not', () => {
    const view = routineView({ routines: [routine] }, 'a', { unit: 'lb', names })
    expect(view.rows.map(r => r.superset)).toEqual([false, true, true, false, false])
  })
  test('an exercise with no name reads as the Workout tab says it', () => {
    expect(routineView({ routines: [routine] }, 'a', { unit: 'lb', names }).rows[4].name).toBe('Unknown exercise (mystery)')
  })
  test('a routine with no rule of its own follows linear', () => {
    expect(routineView({ routines: [pull] }, 'b', { unit: 'lb', names }).progLabel).toBe('Progression: Linear progression')
  })
  test('cardio speed reads in mph, as the web does for a pounds profile', () => {
    const run = { id: 'r', name: 'Run', ex: [{ id: 'run', mode: 'cardio', sets: 1, min: 20, speed: 8 }] }
    expect(routineView({ routines: [run] }, 'r', { unit: 'lb' }).rows[0].line).toBe('1 × 20 min @ 5 mph')
  })
  test('a missing routine is null', () => {
    expect(routineView({ routines: [routine] }, 'nope', { unit: 'lb', names })).toBeNull()
    expect(routineView(null, 'a', { unit: 'lb' })).toBeNull()
  })
  test('a routine whose ex is not a list has no rows; non-object slots are skipped but indexes stay true', () => {
    expect(routineView({ routines: [{ id: 'x', name: 'Odd', ex: 'oops' }] }, 'x', { unit: 'lb' }).rows).toEqual([])
    const holed = { id: 'h', name: 'Holes', ex: [null, { id: 'bench', sets: 3, reps: 10 }] }
    expect(routineView({ routines: [holed] }, 'h', { unit: 'lb', names }).rows.map(r => r.index)).toEqual([1])
  })
  test('the first routine with an id is the one shown, as the guard matches', () => {
    const state = { routines: [{ id: 'a', name: 'First', ex: [] }, { id: 'a', name: 'Second', ex: [] }] }
    expect(findRoutine(state, 'a').name).toBe('First')
    expect(routineView(state, 'a', { unit: 'lb' }).name).toBe('First')
  })
})

describe('baseRoutine: the routine as the server holds it, without the overlay', () => {
  const bundled = { state: { routines: [{ id: 'a', name: 'Snapshot', _ts: 5, ex: [] }] } }
  const copy = { state: { routines: [{ id: 'a', name: 'Copy', _ts: 9, ex: [] }] } }
  test("paired: the copy's routine", () => {
    expect(baseRoutine({ copy, bundled }, 'a')).toBe(copy.state.routines[0])
  })
  test("unpaired: the bundled snapshot's routine", () => {
    expect(baseRoutine({ copy: null, bundled }, 'a')).toBe(bundled.state.routines[0])
  })
  test('a routine neither holds, or a list that is not one, is null', () => {
    expect(baseRoutine({ copy, bundled }, 'b')).toBeNull()
    expect(baseRoutine({ copy: { state: { routines: 'x' } }, bundled }, 'a')).toBeNull()
    expect(baseRoutine({ copy: null, bundled: null }, 'a')).toBeNull()
  })
  test('editBase: an edit made with no copy held (on the snapshot) starts its row fresh; one made on the copy does not', () => {
    expect(editBase({ copy, bundled }, 'a')).toEqual({ base: copy.state.routines[0], fresh: false })
    expect(editBase({ copy: null, bundled }, 'a')).toEqual({ base: bundled.state.routines[0], fresh: true })
    expect(editBase({ copy: null, bundled }, 'b')).toEqual({ base: null, fresh: true })
  })
})

describe('savedRoutine: what Save writes', () => {
  const routine = { id: 'a', name: 'Push A', _ts: 9, note: 'keep', ex: [{ id: 'bench', sets: 3, reps: 10, note: 'n' }, { id: 'ohp', sets: 3, reps: 8 }] }
  test('an unchanged draft writes nothing', () => {
    expect(savedRoutine(routine, 0, slotForm(routine.ex[0], routine))).toBeNull()
  })
  test('a changed draft replaces only its slot and keeps every other key', () => {
    const next = savedRoutine(routine, 0, { ...slotForm(routine.ex[0], routine), sets: 4 })
    expect(next).toEqual({ ...routine, ex: [{ id: 'bench', sets: 4, reps: 10, note: 'n' }, routine.ex[1]] })
    expect(next.ex[1]).toBe(routine.ex[1])
    expect(routine.ex[0].sets).toBe(3)
  })
  test('an index with no slot writes nothing', () => {
    expect(savedRoutine(routine, 5, { sets: 4 })).toBeNull()
  })
})

describe('draftChanged: what holds Move and Swap back', () => {
  const slot = { id: 'bench', sets: 3, reps: 10 }
  const routine = { id: 'a', ex: [slot] }
  const opened = slotForm(slot, routine)
  test('a stepped value is a change', () => {
    expect(draftChanged(slot, routine, opened, stepForm(opened, 'sets', 1))).toBe(true)
  })
  test('a rule picked and picked back, or a value stepped and back, is not', () => {
    const back = withProg(withProg(opened, 'double', slot, routine), '', slot, routine)
    expect(draftChanged(slot, routine, opened, back)).toBe(false)
    expect(draftChanged(slot, routine, opened, stepForm(stepForm(opened, 'reps', 1), 'reps', -1))).toBe(false)
  })
})

describe('sheetView: the controls the sheet shows', () => {
  const r = ex => ({ id: 'a', name: 'R', ex: [ex] })
  const view = slot => sheetView(slotForm(slot, r(slot)), slot, r(slot))
  test('reps: Sets and Reps, then the progression choices with the draft rule selected', () => {
    const slot = { id: 'bench', sets: 3, reps: 10, prog: 'linear' }
    const v = view(slot)
    expect(v.editable).toBe(true)
    expect(v.fields).toEqual([
      { key: 'sets', label: 'Sets', value: 3, step: 1, min: 1 },
      { key: 'reps', label: 'Reps', value: 10, step: 1, min: 1 },
    ])
    expect(v.choices[0]).toEqual({ value: '', label: 'Follow the routine (Linear progression)', selected: false })
    expect(v.choices.find(c => c.selected).value).toBe('linear')
  })
  test('a range rule shows Reps from and Reps up to; per side steps by 2', () => {
    const slot = { id: 'bench', sets: 3, reps: 12, repsMin: 8, prog: 'double', side: true }
    expect(view(slot).fields.slice(1)).toEqual([
      { key: 'repsMin', label: 'Reps from', value: 8, step: 2, min: 2 },
      { key: 'reps', label: 'Reps up to', value: 12, step: 2, min: 2 },
    ])
  })
  test('timed: Sets and Seconds by 5', () => {
    expect(view({ id: 'plank', mode: 'time', sets: 3, sec: 45 }).fields).toEqual([
      { key: 'sets', label: 'Sets', value: 3, step: 1, min: 1 },
      { key: 'sec', label: 'Seconds', value: 45, step: 5, min: 1 },
    ])
  })
  test('cardio: Intervals and Minutes, no progression choices', () => {
    const v = view({ id: 'run', mode: 'cardio', sets: 1, min: 30 })
    expect(v.fields).toEqual([
      { key: 'sets', label: 'Intervals', value: 1, step: 1, min: 1 },
      { key: 'min', label: 'Minutes', value: 30, step: 1, min: 1 },
    ])
    expect(v.choices).toBeNull()
  })
  test('a pyramid shows no sets, reps or choices and cannot be saved', () => {
    const v = view({ id: 'bench', sets: 3, reps: 10, pyramid: [10, 8, 6] })
    expect(v).toMatchObject({ editable: false, pyramid: true, fields: [], choices: null })
  })
  test('a blank value shows the default Save would write', () => {
    const slot = { id: 'bench' }
    expect(view(slot).fields.map(f => f.value)).toEqual([3, 10])
  })
})

describe('stepForm', () => {
  const slot = { id: 'bench', sets: 3, reps: 10 }
  const routine = { id: 'a', ex: [slot] }
  test('+ and − move by the step and stop at the floor', () => {
    const form = slotForm(slot, routine)
    expect(stepForm(form, 'sets', 1).sets).toBe(4)
    expect(stepForm({ ...form, sets: 1 }, 'sets', -1).sets).toBe(1)
    expect(stepForm(slotForm({ id: 'plank', mode: 'time', sets: 3, sec: 5 }, routine), 'sec', -1).sec).toBe(1)
  })
  test('a blank value steps from its default', () => {
    expect(stepForm(slotForm({ id: 'bench' }, routine), 'reps', 1).reps).toBe(11)
  })
})

describe('withProg: switching the rule', () => {
  const slot = { id: 'bench', sets: 3, reps: 10 }
  const routine = { id: 'a', ex: [slot] }
  test('to a range rule: ranged, with the range filled from the reps', () => {
    expect(withProg(slotForm(slot, routine), 'double', slot, routine)).toMatchObject({ prog: 'double', ranged: true, reps: 10, repsMin: 8 })
  })
  test('back off a range rule: Reps again, the range left for Save to drop', () => {
    const ranged = withProg(slotForm(slot, routine), 'double', slot, routine)
    expect(withProg(ranged, 'linear', slot, routine)).toMatchObject({ prog: 'linear', ranged: false, reps: 10 })
  })
  test('between range rules the typed range is kept', () => {
    const ranged = { ...withProg(slotForm(slot, routine), 'double', slot, routine), repsMin: 6 }
    expect(withProg(ranged, 'triple', slot, routine)).toMatchObject({ ranged: true, reps: 10, repsMin: 6 })
  })
  test("follow the routine takes the routine's rule", () => {
    const r = { ...routine, prog: 'double' }
    expect(withProg(slotForm({ ...slot, prog: 'linear' }, r), '', slot, r)).toMatchObject({ prog: '', ranged: true })
  })
})
