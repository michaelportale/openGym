import { expect, test } from 'vitest'
import { progression, sessionStart } from '../shared/training.js'
import { FAR_FROM_FAILURE } from '../science/effort.js'
import { whyEntry } from './why-entry.js'
import { buildSessionBase } from './start-session.js'
import { nextTimeLines, savedNextTime } from './next-time.js'

// '0025' is a barbell chest lift: a 5 lb step. No policy named, so the native default (double).
const bench = { id: '0025', sets: 3, reps: 12, repsMin: 8 }
const routine = { id: 'r1', name: 'Push', ex: [bench] }
const names = { '0025': { name: 'Bench press' } }

const work = (w, r, extra = {}) => ({ w, r, done: true, ...extra })
const warm = (w, r, extra = {}) => work(w, r, { phase: 'warmup', warmup: true, ...extra })

// A workout of `routine` as the phone saves it: the entry carries its routine, target and plan.
function session(id, d, sets, cfg = bench, rid = 'r1') {
  return {
    id, d, routineIds: [rid],
    entries: [{ id: cfg.id, rid, target: { ...cfg }, planned: progression.plannedOf(cfg), sets }],
  }
}

const older = session('w1', '2026-11-02', [work(75, 12), work(75, 12), work(75, 12)])
const saved = session('s1', '2026-11-09', [work(80, 12), work(80, 12), work(80, 12)])
const withSaved = { unit: 'lb', routines: [routine], workouts: [older, saved] }

const now = Date.parse('2026-11-11T18:00:00-05:00')
const timeZone = 'America/New_York'

test('a double-progression raise reads "next time" at the raised weight, and the next session opens there', () => {
  const lines = nextTimeLines(withSaved, routine, saved.entries, names)
  expect(lines).toEqual([{
    exerciseId: '0025',
    name: 'Bench press',
    kind: 'up',
    weight: 85,
    unit: 'lb',
    reps: '8–12',
    text: 'Bench press — next time 85 lb × 8–12',
    reason: 'Top of the rep range in every set. 5 lb more, back to 8 reps.',
    effortNote: null,
    whyId: 'double-progression',
  }])
  // The line's Why opens the progression entry.
  expect(whyEntry('progression').id).toBe(lines[0].whyId)

  // The next session opens at the line: the raised weight, the reps back at the bottom of the range.
  const next = buildSessionBase({ state: withSaved, routine, now, timeZone, id: 'n1' })
  expect(next.entries[0].sets.map(s => [s.w, s.r])).toEqual([[85, 8], [85, 8], [85, 8]])
})

test('the just-saved workout drives the line: without it the older session would', () => {
  const before = nextTimeLines({ ...withSaved, workouts: [older] }, routine, saved.entries, names)
  expect(before[0].weight).toBe(80)
  expect(nextTimeLines(withSaved, routine, saved.entries, names)[0].weight).toBe(85)
})

test('savedNextTime merges the phone workouts, the just-saved one included, into the session state', () => {
  // The state the session opened with predates the save; the phone's list now holds it.
  const opened = { unit: 'lb', routines: [routine], workouts: [older] }
  const lines = savedNextTime({ state: opened, base: { id: 's1', routineIds: ['r1'] }, phoneWorkouts: [saved], names })
  expect(lines.map(l => [l.exerciseId, l.weight])).toEqual([['0025', 85]])
})

test('savedNextTime shows nothing without the saved workout or its routine', () => {
  const opened = { unit: 'lb', routines: [routine], workouts: [older] }
  expect(savedNextTime({ state: opened, base: { id: 'gone', routineIds: ['r1'] }, phoneWorkouts: [saved], names })).toEqual([])
  expect(savedNextTime({ state: opened, base: { id: 's1', routineIds: ['other'] }, phoneWorkouts: [saved], names })).toEqual([])
  expect(savedNextTime({ state: opened, base: null, phoneWorkouts: null, names })).toEqual([])
})

test('progression off, on the routine or the exercise, or a routine kept out of progression: no line', () => {
  const offRoutine = { ...routine, prog: 'off' }
  expect(nextTimeLines({ ...withSaved, routines: [offRoutine] }, offRoutine, saved.entries, names)).toEqual([])
  const offEx = { ...routine, ex: [{ ...bench, prog: 'off' }] }
  expect(nextTimeLines({ ...withSaved, routines: [offEx] }, offEx, saved.entries, names)).toEqual([])
  const excluded = { ...routine, excludeFromProgression: true }
  expect(nextTimeLines({ ...withSaved, routines: [excluded] }, excluded, saved.entries, names)).toEqual([])
})

test('a heavy warm-up changes nothing: same line as without it', () => {
  // Work sets inside the range hold at 80. A 200 lb warm-up read as work would be the load.
  const plain = session('s2', '2026-11-09', [work(80, 10), work(80, 9), work(80, 9)])
  const heavy = session('s2', '2026-11-09', [warm(200, 12, { rir: 8 }), work(80, 10), work(80, 9), work(80, 9)])
  const a = nextTimeLines({ ...withSaved, workouts: [older, plain] }, routine, plain.entries, names)
  const b = nextTimeLines({ ...withSaved, workouts: [older, heavy] }, routine, heavy.entries, names)
  expect(b).toEqual(a)
  expect(b[0]).toMatchObject({ kind: 'hold', weight: 80, effortNote: null })
})

test('many reps left adds the far-from-failure note and never changes the weight', () => {
  const rated = session('s1', '2026-11-09', [work(80, 12, { rir: 5 }), work(80, 12), work(80, 12, { rir: 2 })])
  const lines = nextTimeLines({ ...withSaved, workouts: [older, rated] }, routine, rated.entries, names)
  const plain = nextTimeLines(withSaved, routine, saved.entries, names)
  expect(lines[0].effortNote).toBe(FAR_FROM_FAILURE)
  expect({ ...lines[0], effortNote: null }).toEqual(plain[0])
  expect(whyEntry('effort').id).toBe('effort-proximity')
})

test('reps left on a set that was not done says nothing', () => {
  const undone = session('s1', '2026-11-09', [work(80, 12), work(80, 12), work(80, 12), work(80, 12, { done: false, rir: 6 })])
  const lines = nextTimeLines({ ...withSaved, workouts: [older, undone] }, routine, undone.entries, names)
  expect(lines[0].effortNote).toBeNull()
})

test('no line without a weight: a first session and timed work', () => {
  // No history at all: the engine's 'first' carries no weight.
  const fresh = { id: '0313', sets: 3, reps: 10 }
  const both = { ...routine, ex: [bench, fresh] }
  const lines = nextTimeLines({ unit: 'lb', routines: [both], workouts: [] }, both, [...saved.entries, { id: '0313', sets: [] }], names)
  expect(lines).toEqual([])

  const plank = { id: '0025', mode: 'time', sets: 3, sec: 45 }
  const timed = { ...routine, ex: [plank] }
  const held = session('t1', '2026-11-09', [{ sec: 45, w: 0, done: true }, { sec: 45, w: 0, done: true }, { sec: 45, w: 0, done: true }], plank)
  expect(nextTimeLines({ unit: 'lb', routines: [timed], workouts: [held] }, timed, held.entries, names)).toEqual([])
})

test('an exercise the routine does not hold has no line, and each exercise has one line', () => {
  const twice = { ...saved, entries: [...saved.entries, { ...saved.entries[0] }, { id: '9999', sets: [work(10, 10)] }] }
  const lines = nextTimeLines(withSaved, routine, twice.entries, names)
  expect(lines.map(l => l.exerciseId)).toEqual(['0025'])
})

test('the unit is the profile unit, lb when unset, and the step follows it', () => {
  const kg = nextTimeLines({ ...withSaved, unit: 'kg' }, routine, saved.entries, names)[0]
  expect(kg).toMatchObject({ weight: 82.5, unit: 'kg', text: 'Bench press — next time 82.5 kg × 8–12' })
  const unset = nextTimeLines({ ...withSaved, unit: undefined }, routine, saved.entries, names)[0]
  expect(unset).toMatchObject({ weight: 85, unit: 'lb', text: 'Bench press — next time 85 lb × 8–12' })
})

test('without a stored range the line gives the aim; an unknown name still reads', () => {
  const single = { id: '0025', sets: 3, reps: 10 }
  const r = { ...routine, ex: [single] }
  const held = session('s1', '2026-11-09', [work(80, 8), work(80, 8), work(80, 8)], single)
  const [line] = nextTimeLines({ unit: 'lb', routines: [r], workouts: [held] }, r, held.entries, {})
  expect(line).toMatchObject({ kind: 'hold', weight: 80, reps: '9', text: 'Unknown exercise (0025) — next time 80 lb × 9' })
  expect(line.reason).toBe('Same weight, aim for 9 reps this time.')
})

test('per-side reps read per side with no both-sides reason, per-hand weights read each', () => {
  const curl = { id: '0289', sets: 2, reps: 24, repsMin: 16, side: true, dbLoad: 'each' }
  const r = { ...routine, ex: [curl] }
  const sided = (w, r) => ({ w, r, done: true, sides: { L: { w, r: r / 2, done: true }, R: { w, r: r / 2, done: true } } })
  const done = session('s1', '2026-11-09', [sided(20, 24), sided(20, 24)], curl)
  const [line] = nextTimeLines({ unit: 'lb', routines: [r], workouts: [done] }, r, done.entries, { '0289': { name: 'Curl' } })
  expect(line).toMatchObject({ weight: 25, reps: '8–12 per side', text: 'Curl — next time 25 lb each × 8–12 per side' })
  // The engine's reason would say "back to 16 reps" (both sides): not shown beside a per-side line.
  expect(line.reason).toBeNull()
})

test('only double progression has lines: linear, greyskull and triple have no register entry', () => {
  for (const prog of ['linear', 'greyskull', 'triple']) {
    for (const r of [{ ...routine, prog }, { ...routine, ex: [{ ...bench, prog }] }]) {
      expect(nextTimeLines({ ...withSaved, routines: [r] }, r, saved.entries, names)).toEqual([])
    }
  }
  // Named double is the same as the unnamed native default.
  const named = { ...routine, prog: 'double' }
  expect(nextTimeLines({ ...withSaved, routines: [named] }, named, saved.entries, names)).toEqual(nextTimeLines(withSaved, routine, saved.entries, names))
})

test('a double-progression deload line opens the deload register entry', () => {
  // Three sessions at 80 with no rep gained: the third stall deloads.
  const stalled = ['2026-11-02', '2026-11-05', '2026-11-09'].map((d, i) => session(`d${i}`, d, [work(80, 9), work(80, 9), work(80, 9)]))
  const [line] = nextTimeLines({ ...withSaved, workouts: stalled }, routine, stalled[2].entries, names)
  expect(line.kind).toBe('deload')
  expect(line.weight).toBeLessThan(80)
  expect(line.whyId).toBe('deload-after-misses')
  expect(whyEntry('deload').id).toBe(line.whyId)
  // A raise or a hold keeps the progression entry.
  expect(nextTimeLines(withSaved, routine, saved.entries, names)[0].whyId).toBe('double-progression')
})

test('an exercise with no completed work set in the saved session has no line', () => {
  // Last week topped the range; today bench was skipped (nothing done, or only a warm-up done).
  for (const sets of [[], [work(80, 12, { done: false }), work(80, 12, { done: false })], [warm(45, 10)]]) {
    const skipped = session('s1', '2026-11-09', sets)
    const lines = nextTimeLines({ ...withSaved, workouts: [older, skipped] }, routine, skipped.entries, names)
    expect(lines).toEqual([])
  }
})

test('an unnamed pyramid has no line: the engine never progresses one', () => {
  const pyramid = { ...routine, ex: [{ ...bench, pyramid: [12, 10, 8] }] }
  expect(nextTimeLines({ ...withSaved, routines: [pyramid] }, pyramid, saved.entries, names)).toEqual([])
})

test('a dumbbell switched from total to each reads its history converted, as the shared builder does', () => {
  // '1175' is a two-bell dumbbell lift with a 10 lb step. Logged at 80 total = 40 each; now each.
  const curl = { id: '1175', sets: 3, reps: 12, repsMin: 8, dbLoad: 'each' }
  const r = { ...routine, prog: 'double', ex: [curl] }
  const total = session('s1', '2026-11-09', [work(80, 12), work(80, 12), work(80, 12)], { ...curl, dbLoad: 'total' })
  total.entries[0].equipmentSnapshot = { stationId: null, loadConvention: 'db-total', unit: 'lb', status: 'unknown' }
  const S = { unit: 'lb', routines: [r], workouts: [total] }
  const shared = sessionStart.buildPlannedEntry(S, curl, r).plan
  expect(shared).toMatchObject({ weight: 50, reps: 8 })

  const [line] = nextTimeLines(S, r, total.entries, { '1175': { name: 'Curl' } })
  expect(line).toMatchObject({ weight: 50, text: 'Curl — next time 50 lb each × 8–12' })
  const next = buildSessionBase({ state: S, routine: r, now, timeZone, id: 'n1' })
  expect(next.entries[0].sets.map(s => [s.w, s.r])).toEqual([[50, 8], [50, 8], [50, 8]])
})

test('bodyweight work reads as bodyweight, not 0 lb', () => {
  const pushup = { id: '0999', sets: 2, reps: 10, repsMin: 10 }
  const r = { ...routine, ex: [pushup] }
  const done = session('s1', '2026-11-09', [work(0, 10), work(0, 10)], pushup)
  const [line] = nextTimeLines({ unit: 'lb', routines: [r], workouts: [done] }, r, done.entries, { '0999': { name: 'Push-up' } })
  expect(line.weight).toBe(0)
  expect(line.text).toMatch(/^Push-up — next time bodyweight × /)
})

test('does not mutate its inputs', () => {
  const before = JSON.stringify({ withSaved, routine })
  nextTimeLines(withSaved, routine, saved.entries, names)
  expect(JSON.stringify({ withSaved, routine })).toBe(before)
})
