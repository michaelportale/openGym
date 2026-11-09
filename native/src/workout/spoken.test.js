import { describe, expect, test } from 'vitest'
import { primaryAction } from './set-calls.js'
import { spokenDuration, spokenField, spokenLead, spokenPrimaryHint, spokenUpNext } from './spoken.js'
import { workoutScreen } from './workout-view.js'

describe('spokenField', () => {
  test('names the field and its value in words', () => {
    expect(spokenField('w', '75', { perHand: true })).toBe('Weight, 75 pounds each')
    expect(spokenField('w', '75')).toBe('Weight, 75 pounds')
    expect(spokenField('w', 1)).toBe('Weight, 1 pound')
    expect(spokenField('r', '8')).toBe('Reps, 8')
    expect(spokenField('L.r', '20')).toBe('Left reps, 20')
    expect(spokenField('R.r', '18')).toBe('Right reps, 18')
  })
  test('a blank field is not set, never a dash', () => {
    expect(spokenField('r', '–')).toBe('Reps, not set')
    expect(spokenField('w', null, { perHand: true })).toBe('Weight, not set')
    expect(spokenField('L.r', '')).toBe('Left reps, not set')
  })
  test('zero is a real value', () => {
    expect(spokenField('w', '0')).toBe('Weight, 0 pounds')
  })
  test("a per-side row's reps are said side by side", () => {
    expect(spokenField('r', '20 / 18')).toBe('Reps, left 20, right 18')
    expect(spokenField('r', '– / 18')).toBe('Reps, left not set, right 18')
  })
  // A half-done per-side set's weight is the one its first side was logged at, and cannot change.
  test('a weight set with the other side says so', () => {
    expect(spokenField('w', '7.5', { perHand: true, setWith: 'L' })).toBe('Weight, 7.5 pounds each, set with the left side')
    expect(spokenField('w', '7.5', { setWith: 'R' })).toBe('Weight, 7.5 pounds, set with the right side')
    expect(spokenField('w', '7.5', { setWith: null })).toBe('Weight, 7.5 pounds')
  })
  test('an unknown field throws', () => {
    expect(() => spokenField('x', '1')).toThrow('x')
    expect(() => spokenField('constructor', '1')).toThrow('constructor')
  })
})

describe('spokenDuration', () => {
  test('says minutes and seconds, rounding up like the countdown', () => {
    expect(spokenDuration(64_000)).toBe('1 minute 4 seconds')
    expect(spokenDuration(59_001)).toBe('1 minute')
    expect(spokenDuration(1_000)).toBe('1 second')
    expect(spokenDuration(125_000)).toBe('2 minutes 5 seconds')
    expect(spokenDuration(3_601_000)).toBe('1 hour 1 second')
  })
  test('nothing left is zero seconds', () => {
    expect(spokenDuration(0)).toBe('0 seconds')
    expect(spokenDuration(-5)).toBe('0 seconds')
    expect(spokenDuration(undefined)).toBe('0 seconds')
  })
})

describe('spokenLead', () => {
  const ready = { mode: 'ready', lead: 'Set 2 · 75 lb each × 8', number: 2, figures: { w: 75, r: 8 }, side: null }
  test("says the dock's set in words", () => {
    expect(spokenLead(ready, { perHand: true })).toBe('Set 2, 75 pounds each, 8 reps')
    expect(spokenLead({ ...ready, figures: { w: 1, r: 1 } })).toBe('Set 2, 1 pound, 1 rep')
  })
  test('a blank weight or reps is not set', () => {
    expect(spokenLead({ ...ready, mode: 'enter-weight', figures: { w: null, r: 12 } })).toBe('Set 2, weight not set, 12 reps')
    expect(spokenLead({ ...ready, mode: 'enter-reps', figures: { w: 75, r: null } })).toBe('Set 2, 75 pounds, reps not set')
  })
  test('a per-side set says which side is up', () => {
    expect(spokenLead({ ...ready, figures: { w: 10, r: 12 }, side: 'L' }, { perHand: true })).toBe('Set 2, left side, 10 pounds each, 12 reps')
    expect(spokenLead({ ...ready, figures: { w: 10, r: 11 }, side: 'R' })).toBe('Set 2, right side, 10 pounds, 11 reps')
  })
  test('resting says the time left in words, then the set after it', () => {
    expect(spokenLead({ mode: 'resting', lead: '1:04', remainingMs: 64_000, number: null, figures: null, side: null }))
      .toBe('Rest, 1 minute 4 seconds left')
    expect(spokenLead({ mode: 'resting', lead: '1:04', remainingMs: 64_000, number: 2, figures: { w: 75, r: 8 }, side: null }, { perHand: true }))
      .toBe('Rest, 1 minute 4 seconds left. Next, set 2, 75 pounds each, 8 reps')
  })
  test('with no set up, the lead says it already', () => {
    expect(spokenLead({ mode: 'exercise-done', lead: 'Exercise done', number: null, figures: null })).toBe('Exercise done')
    expect(spokenLead({ mode: 'all-done', lead: 'All sets done' })).toBe('All sets done')
    expect(spokenLead({ mode: 'overnight', lead: 'Left open overnight' })).toBe('Left open overnight')
  })

  // The real dock carries what the words need, so they cannot drift from what it shows.
  const row = (setId, w, r, finished) => ({ setId, completed: finished, warmup: false, draft: null, row: { w, r, done: finished } })
  const entry = (target, rows) => ({ id: '0289', target, sets: rows })
  const dockOf = (entries, rest = null) => workoutScreen({ status: 'active', entries, rest, elapsedMs: 0 }, { names: {}, lastTimes: {} }).dock
  test("matches the dock workoutScreen builds", () => {
    const sets = [row('a', 75, 10, true), row('b', 75, 8, false)]
    expect(spokenLead(dockOf([entry({ dbLoad: 'each' }, sets)]), { perHand: true })).toBe('Set 2, 75 pounds each, 8 reps')
    expect(spokenLead(dockOf([entry({}, sets)], { status: 'running', remainingMs: 64_000 })))
      .toBe('Rest, 1 minute 4 seconds left. Next, set 2, 75 pounds, 8 reps')
    expect(spokenLead(dockOf([entry({}, [row('a', null, 12, false)])]))).toBe('Set 1, weight not set, 12 reps')
    expect(spokenLead(dockOf([entry({}, [row('a', 75, 10, true)])], { status: 'running', remainingMs: 64_000 })))
      .toBe('Rest, 1 minute 4 seconds left')
  })
})

// The dock's main button writes at once on Complete, so its hint says what a tap will do.
describe('spokenPrimaryHint', () => {
  test('says what the main button does in each mode', () => {
    expect(spokenPrimaryHint('ready')).toBe('Logs this set and starts the rest.')
    expect(spokenPrimaryHint('enter-weight')).toBe('Opens the keypad.')
    expect(spokenPrimaryHint('enter-reps')).toBe('Opens the keypad.')
    expect(spokenPrimaryHint('exercise-done')).toBe('Shows the next exercise with sets left.')
    expect(spokenPrimaryHint('all-done')).toBe('Shows the summary before saving.')
  })
  test("the screen's overnight and unsaved docks say theirs", () => {
    // The suggested end is the last set, or the time it was offered when that set was under 20
    // minutes before (sessionEnd): the hint says both, never only "at its last set".
    expect(spokenPrimaryHint('overnight')).toBe('Shows the summary. Ends at your last set, or now if that was under 20 minutes ago.')
    expect(spokenPrimaryHint('finished')).toBe('Shows the summary before saving.')
  })
  // Rest starts only when both sides of a per-side set are done (rest-after.js).
  test('one side of a per-side set promises no rest of its own', () => {
    expect(spokenPrimaryHint('ready', { side: 'L' })).toBe('Logs this side. Rest starts once both sides are done.')
    expect(spokenPrimaryHint('ready', { side: 'R' })).toBe('Logs this side. Rest starts once both sides are done.')
    expect(spokenPrimaryHint('enter-reps', { side: 'R' })).toBe('Opens the keypad.')
  })
  test('every mode whose button set-calls routes has a hint', () => {
    for (const mode of ['ready', 'enter-weight', 'enter-reps', 'exercise-done', 'all-done']) {
      expect(primaryAction(mode), mode).not.toBe('none')
      expect(spokenPrimaryHint(mode), mode).toMatch(/\.$/)
    }
  })
  test('a mode with no main button has no hint', () => {
    expect(spokenPrimaryHint('resting')).toBeUndefined()
    expect(spokenPrimaryHint('constructor')).toBeUndefined()
  })
})

describe('spokenUpNext', () => {
  test('names the next exercise', () => {
    expect(spokenUpNext('Cable lateral raise')).toBe('Up next, Cable lateral raise.')
  })
  test('a missing name throws rather than saying nothing', () => {
    expect(() => spokenUpNext('  ')).toThrow('name')
    expect(() => spokenUpNext(undefined)).toThrow('name')
  })
})
