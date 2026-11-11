import { describe, expect, test } from 'vitest'
import {
  DELETE_BODY, MISSING_ROUTINE, UNSAFE_EDIT, baseRoutine, deleteTitle, draftChanged, editBase, findRoutine, indexOfKey, leaveForPlan, movedText, noticeLines, planView, removeTitle, routineAuthoring, routineProgChoices, routineView, savedRoutine, sheetView, stepForm, withProg,
  PAIR_TO_AUTHOR, orderMoved, planNotices, routineCreateEdit, routineDeleteEdit, routineOrderEdit,
} from './plan-view.js'
import { slotForm } from './slot-edit.js'
import { progression } from '../shared/training.js'
import { ROUTINE_DELETED, applyEdits } from '../sync/edit-guard.js'
import { createMemoryPendingEdits } from '../sync/pending-edits.js'

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
    { kind: 'routine', key: 'a', name: 'Push A', reason: 'changed', at: '1' },
    { kind: 'routine', key: 'b', name: 'Pull B', reason: 'deleted', at: '2' },
    { kind: 'routine', key: 'c', name: 'Legs', reason: 'unsafe', at: '3' },
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
    expect(noticeLines([{ kind: 'routine', key: 'a', name: '', reason: 'changed' }, { kind: 'routine', key: 'b', name: '  ', reason: 'deleted' }, { kind: 'routine', key: 'c', name: null, reason: 'unsafe' }])).toEqual([
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

describe('7E-A: notices for every routine edit that was not sent', () => {
  const line = (rid, text, name) => ({ rid, text, dismissLabel: `Dismiss notice about ${name}` })
  test('a create the server refused: deleted, unsafe, and changed (it landed, and a later change lost)', () => {
    expect(noticeLines([
      { kind: 'routine', key: 'n1', name: 'Legs', reason: 'deleted', op: 'create' },
      { kind: 'routine', key: 'n2', name: 'Arms', reason: 'unsafe', op: 'create' },
      { kind: 'routine', key: 'n3', name: 'Core', reason: 'changed', op: 'create' },
    ])).toEqual([
      line('n1', "Legs wasn't added: a routine with that id was deleted on your server.", 'Legs'),
      line('n2', "Arms wasn't added: it couldn't be sent safely. Try adding it again.", 'Arms'),
      line('n3', "Your change to Core wasn't sent: it was changed on the web first. This shows the web's version.", 'Core'),
    ])
  })
  test('a delete the web overtook', () => {
    expect(noticeLines([{ kind: 'routine', key: 'a', name: 'Push A', reason: 'changed', op: 'delete' }])).toEqual([
      line('a', "Push A changed on the web, so it wasn't deleted.", 'Push A'),
    ])
  })
  test('an order the web overtook: named "Your routine order", never its key, and dismissed as its own kind', () => {
    expect(noticeLines([{ kind: 'routineOrder', key: 'routineOrder', name: 'routineOrder', reason: 'changed', op: 'order' }])).toEqual([
      { rid: 'routineOrder', kind: 'routineOrder', text: "Your routine order wasn't sent: it changed on the web first.", dismissLabel: 'Dismiss notice about your routine order' },
    ])
  })
  test('an order notice reads as one by its kind alone', () => {
    expect(noticeLines([{ kind: 'routineOrder', key: 'routineOrder', name: 'routineOrder', reason: 'changed' }])[0].text)
      .toBe("Your routine order wasn't sent: it changed on the web first.")
  })
  test('an edit keeps the 7C wording, op or none', () => {
    expect(noticeLines([
      { kind: 'routine', key: 'a', name: 'Push A', reason: 'changed', op: 'edit' },
      { kind: 'routine', key: 'b', name: 'Pull B', reason: 'deleted', op: 'edit' },
      { kind: 'routine', key: 'c', name: 'Legs', reason: 'unsafe', op: 'edit' },
    ]).map(l => l.text)).toEqual([
      "Your change to Push A wasn't sent: it was changed on the web first. This shows the web's version.",
      "Your change to Pull B wasn't sent: it was deleted on the web.",
      "Your change to Legs wasn't sent: this move or swap has to be made on the web.",
    ])
  })
  test('a blank name opening a sentence reads as This routine', () => {
    expect(noticeLines([
      { kind: 'routine', key: 'n1', name: '', reason: 'deleted', op: 'create' },
      { kind: 'routine', key: 'n2', name: ' ', reason: 'unsafe', op: 'create' },
      { kind: 'routine', key: 'a', name: '', reason: 'changed', op: 'delete' },
    ])).toEqual([
      line('n1', "This routine wasn't added: a routine with that id was deleted on your server.", 'this routine'),
      line('n2', "This routine wasn't added: it couldn't be sent safely. Try adding it again.", 'this routine'),
      line('a', "This routine changed on the web, so it wasn't deleted.", 'this routine'),
    ])
  })
})

describe('planNotices: what each notice was, from its stored row', () => {
  const state = { routines: [push, pull] }
  const n = (kind, key, name, reason = 'changed') => ({ kind, key, name, reason, at: '1' })
  test('a create is a routine row on base 0, a delete holds the marker, anything else is an edit', () => {
    const notices = [n('routine', 'new', 'Legs', 'deleted'), n('routine', 'a', ''), n('routine', 'b', 'Pull B'), n('routine', 'seed', 'Seed')]
    const rows = [
      { kind: 'routine', key: 'new', baseTs: 0, value: { id: 'new', name: 'Legs', ex: [] } },
      { kind: 'routine', key: 'a', baseTs: 5, value: JSON.parse(JSON.stringify(ROUTINE_DELETED)) },
      { kind: 'routine', key: 'b', baseTs: 7, value: pull },
      { kind: 'routine', key: 'seed', baseTs: null, value: { id: 'seed', name: 'Seed' } },
    ]
    expect(planNotices(notices, rows, state).map(x => [x.key, x.op, x.name])).toEqual([
      ['new', 'create', 'Legs'], ['a', 'delete', 'Push A'], ['b', 'edit', 'Pull B'], ['seed', 'edit', 'Seed'],
    ])
  })
  test('rows are matched by kind and key, not by place; a notice with no row reads as an edit', () => {
    const notices = [n('routine', 'a', ''), n('routine', 'b', 'Pull B')]
    const rows = [null, { kind: 'routine', key: 'a', baseTs: 5, value: ROUTINE_DELETED }]
    expect(planNotices(notices, rows, state).map(x => [x.key, x.op])).toEqual([['a', 'delete'], ['b', 'edit']])
  })
  test('the order notice is an order; other kinds are not the Plan\'s; the store\'s order is kept', () => {
    const notices = [n('routineOrder', 'routineOrder', 'routineOrder'), n('nutritionDay', '2026-11-01', '2026-11-01'), n('setting', 'supplements', 'supplements'), n('routine', 'b', 'Pull B')]
    expect(planNotices(notices, [], state).map(x => [x.kind, x.op])).toEqual([['routineOrder', 'order'], ['routine', 'edit']])
  })
  test('a delete of a routine the state no longer holds keeps the store\'s name; an edit is never renamed', () => {
    const rows = [{ kind: 'routine', key: 'gone', baseTs: 5, value: ROUTINE_DELETED }, { kind: 'routine', key: 'a', baseTs: 5, value: { id: 'a', name: '' } }]
    expect(planNotices([n('routine', 'gone', ''), n('routine', 'a', '')], rows, state).map(x => x.name)).toEqual(['', ''])
  })
  test('none, or not a list, reads as none', () => {
    expect(planNotices(null, null, state)).toEqual([])
    expect(planNotices(undefined, [], null)).toEqual([])
  })
})

describe('leaveForPlan: a deleted routine returns to the Plan tab', () => {
  const recordingRouter = canDismiss => {
    const calls = []
    return {
      calls,
      canDismiss: () => canDismiss,
      dismissAll: () => calls.push('dismissAll'),
      navigate: href => calls.push(['navigate', href]),
      replace: href => calls.push(['replace', href]),
    }
  }
  test('when the stack can be dismissed, dismissAll then navigate to Plan, and replace is not called', () => {
    const router = recordingRouter(true)
    leaveForPlan(router)
    expect(router.calls).toEqual(['dismissAll', ['navigate', '/(tabs)/plan']])
  })
  test('when the stack cannot be dismissed, the only call is replace with Plan', () => {
    const router = recordingRouter(false)
    leaveForPlan(router)
    expect(router.calls).toEqual([['replace', '/(tabs)/plan']])
  })
})

describe('the routine screen: delete and remove wording', () => {
  test('delete asks by name, with the history sentence', () => {
    expect(deleteTitle('Push A')).toBe('Delete Push A?')
    expect(DELETE_BODY).toBe("It's removed from your plan and your week. Your history keeps its workouts.")
  })
  test('remove asks by the exercise name', () => {
    expect(removeTitle('Bench Press')).toBe('Remove Bench Press?')
  })
})

describe('routineProgChoices: the routine rule as rows', () => {
  test('unset prog selects linear, and each reps policy keeps its name', () => {
    expect(routineProgChoices({ id: 'a', ex: [] })).toEqual(progression.POLICIES_FOR.reps.map(value => ({
      value,
      label: progression.POLICY_NAME[value],
      selected: value === 'linear',
    })))
  })
  test("prog double selects Double progression and no other row", () => {
    const choices = routineProgChoices({ id: 'a', prog: 'double', ex: [] })
    expect(choices.filter(c => c.selected)).toEqual([{ value: 'double', label: 'Double progression', selected: true }])
  })
})

describe('routineAuthoring: duplicate, delete and add need a server copy', () => {
  test('all three while a copy is held, none when it is null', () => {
    expect(routineAuthoring({ rev: 3, state: {} })).toEqual({ canDuplicate: true, canDelete: true, canAdd: true })
    expect(routineAuthoring(null)).toEqual({ canDuplicate: false, canDelete: false, canAdd: false })
  })
})

describe('planView: who may add, delete or reorder', () => {
  test('canAuthor only while a server copy is held', () => {
    expect(planView({ routines: [push] }, { copy: { rev: 3, state: {} } }).canAuthor).toBe(true)
    expect(planView({ routines: [push] }, { copy: null }).canAuthor).toBe(false)
    expect(planView({ routines: [push] }, {}).canAuthor).toBe(false)
  })
  test('the sentence shown in their place', () => {
    expect(PAIR_TO_AUTHOR).toBe('Pair with your server to add, delete or reorder routines.')
  })
})

describe('orderMoved: the order a tap on Move up or Move down saves', () => {
  const rows = planView({ routines: [push, null, pull, legs] }, {}).routines
  test('every routine id as the Plan lists them, the one tapped moved one place', () => {
    expect(orderMoved(rows, 'c', -1)).toEqual(['a', 'c', 'b'])
    expect(orderMoved(rows, 'a', 1)).toEqual(['b', 'a', 'c'])
    expect(orderMoved(rows, 'b', -1)).toEqual(['b', 'a', 'c'])
  })
  test('null at an edge, for a routine not listed, or a bad direction', () => {
    expect(orderMoved(rows, 'a', -1)).toBeNull()
    expect(orderMoved(rows, 'c', 1)).toBeNull()
    expect(orderMoved(rows, 'gone', 1)).toBeNull()
    expect(orderMoved(rows, 'b', 2)).toBeNull()
  })
  test('null for a list the store could not hold or a tap could not find: an id that is not a string, or one held twice', () => {
    expect(orderMoved([{ id: 'a' }, { id: 7 }, { id: 'c' }], 'a', 1)).toBeNull()
    expect(orderMoved([{ id: 'a' }, {}, { id: 'c' }], 'c', -1)).toBeNull()
    expect(orderMoved([{ id: 'a' }, { id: 'b' }, { id: 'a' }], 'b', 1)).toBeNull()
  })
  test('the rows are left alone', () => {
    const before = JSON.stringify(rows)
    orderMoved(rows, 'b', 1)
    expect(JSON.stringify(rows)).toBe(before)
  })
  test('none reads as none', () => {
    expect(orderMoved(null, 'a', 1)).toBeNull()
    expect(orderMoved([], 'a', 1)).toBeNull()
  })
})

describe('what a create, a delete and an order put in the store', () => {
  const copy = { rev: 4, state: { routines: [{ ...push, _ts: 5 }, { ...pull, _ts: 6 }], edited: { routineOrder: 9 } } }
  test('a create: the routine on base 0', () => {
    const r = { id: 'n1', name: 'Legs', emoji: 'figureStrength', ex: [] }
    expect(routineCreateEdit(r)).toEqual({ kind: 'routine', key: 'n1', baseTs: 0, value: r })
  })
  test("a delete: the marker on the copy's routine _ts, or null with none, and it starts fresh", () => {
    expect(routineDeleteEdit('a', copy.state.routines[0])).toEqual({ kind: 'routine', key: 'a', baseTs: 5, value: ROUTINE_DELETED, fresh: true })
    expect(routineDeleteEdit('a', { ...push })).toEqual({ kind: 'routine', key: 'a', baseTs: null, value: ROUTINE_DELETED, fresh: true })
    expect(routineDeleteEdit('a', null)).toEqual({ kind: 'routine', key: 'a', baseTs: null, value: ROUTINE_DELETED, fresh: true })
  })
  test("an order: every id on the copy's edited.routineOrder, or null with none", () => {
    expect(routineOrderEdit(['b', 'a'], copy)).toEqual({ kind: 'routineOrder', key: 'routineOrder', baseTs: 9, value: ['b', 'a'] })
    expect(routineOrderEdit(['b', 'a'], { state: { routines: [] } })).toMatchObject({ baseTs: null })
    expect(routineOrderEdit(['b', 'a'], null)).toMatchObject({ baseTs: null })
  })
})

describe('the Plan tab\'s edits through the store and the guard', () => {
  const at = '2026-11-10T00:00:00.000Z'
  const settle = async (edits, state) => {
    const pending = await edits.listPending()
    const result = applyEdits(state, pending)
    await edits.markSuperseded(result.superseded, at)
    return result
  }
  const linesOf = async (edits, state) => {
    const listed = await edits.listNotices()
    const rows = []
    for (const x of listed) rows.push(await edits.get(x.kind, x.key))
    return noticeLines(planNotices(listed, rows, state))
  }

  test('a create then a fresh delete before any sync: the base becomes null, the row is done, nothing is sent', async () => {
    const edits = createMemoryPendingEdits()
    const r = { id: 'n1', name: 'Legs', ex: [] }
    const copy = { routines: [{ ...push, _ts: 5 }] }
    await edits.put({ ...routineCreateEdit(r), t: 1 })
    await edits.put({ ...routineDeleteEdit('n1', null), t: 2 })
    // The fresh delete replaces the create's base 0. The routine is absent on the copy, and absent
    // is the marker, which the guard counts as done before it compares stamps, so nothing is applied.
    expect(await edits.get('routine', 'n1')).toMatchObject({ baseTs: null })
    const result = await settle(edits, copy)
    expect(result.done.map(d => d.key)).toEqual(['n1'])
    expect(result.applied).toEqual([])
    expect(result.state).toBe(copy)
  })
  test('a fresh delete of a pending edit whose base is null takes the copy routine _ts and the guard applies it', async () => {
    const edits = createMemoryPendingEdits()
    await edits.put({ kind: 'routine', key: 'a', baseTs: null, value: { ...push, name: 'Local' }, t: 1 })
    await edits.put({ ...routineDeleteEdit('a', { ...push, _ts: 5 }), t: 2 })
    expect(await edits.get('routine', 'a')).toMatchObject({ baseTs: 5, sent: null })
    const copy = { routines: [{ ...push, _ts: 5 }, pull] }
    const result = applyEdits(copy, await edits.listPending())
    expect(result.applied.map(d => d.key)).toEqual(['a'])
    expect(result.superseded).toEqual([])
    expect(result.done).toEqual([])
    expect(result.state.routines.map(r => r.id)).toEqual(['b'])
  })
  test('a delete the web overtook names the routine the web kept', async () => {
    const edits = createMemoryPendingEdits()
    await edits.put({ ...routineDeleteEdit('a', { ...push, _ts: 5 }), t: 1 })
    const web = { routines: [{ ...push, name: 'Push A (heavy)', _ts: 8 }, pull] }
    await settle(edits, web)
    expect(await linesOf(edits, web)).toEqual([
      { rid: 'a', text: "Push A (heavy) changed on the web, so it wasn't deleted.", dismissLabel: 'Dismiss notice about Push A (heavy)' },
    ])
  })
  test('a create of an id the server deleted', async () => {
    const edits = createMemoryPendingEdits()
    await edits.put({ ...routineCreateEdit({ id: 'n1', name: 'Legs', ex: [] }), t: 1 })
    const web = { routines: [push], deleted: { routines: { n1: 12 } } }
    await settle(edits, web)
    expect((await linesOf(edits, web)).map(l => l.text)).toEqual(["Legs wasn't added: a routine with that id was deleted on your server."])
  })
  test('an order: applied on the base it saw, overtaken by a web reorder', async () => {
    const copy = { routines: [push, pull, legs], edited: { routineOrder: 9 } }
    const edits = createMemoryPendingEdits()
    await edits.put({ ...routineOrderEdit(orderMoved(planView(copy, {}).routines, 'c', -1), { state: copy }), t: 1 })
    expect(applyEdits(copy, await edits.listPending()).state.routines.map(r => r.id)).toEqual(['a', 'c', 'b'])
    const web = { routines: [pull, push, legs], edited: { routineOrder: 11 } }
    await settle(edits, web)
    expect(await linesOf(edits, web)).toEqual([
      { rid: 'routineOrder', kind: 'routineOrder', text: "Your routine order wasn't sent: it changed on the web first.", dismissLabel: 'Dismiss notice about your routine order' },
    ])
  })
})
