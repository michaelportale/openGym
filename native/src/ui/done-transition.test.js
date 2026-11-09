import { expect, test } from 'vitest'
import { motionDuration } from '../theme/motion.js'
import { flagMemory } from './accessibility-flag.js'
import { donePop, poppedSetIds, statusBySetId } from './done-transition.js'

const row = (setId, status, extra) => ({ setId, status, ...extra })
const after = (before, rows) => poppedSetIds(statusBySetId(before), rows)

test('a current work set that becomes done pops', () => {
  expect([...after([row('a', 'current')], [row('a', 'done')])]).toEqual(['a'])
})
test('a current warm-up that becomes done pops', () => {
  expect([...after([row('w', 'current', { warmup: true })], [row('w', 'done', { warmup: true })])]).toEqual(['w'])
})
test('a pending set that becomes done pops', () => {
  expect([...after([row('a', 'pending')], [row('a', 'done')])]).toEqual(['a'])
})
test('a per-side set pops when its second side finishes, not its first', () => {
  const first = row('p', 'current', { perSide: true, sideDone: 'L' })
  expect(after([row('p', 'current', { perSide: true })], [first]).size).toBe(0)
  expect([...after([first], [row('p', 'done', { perSide: true })])]).toEqual(['p'])
})
test('first render and remount do not pop (empty map)', () => {
  expect(poppedSetIds(new Map(), [row('a', 'done')]).size).toBe(0)
  expect(poppedSetIds(undefined, [row('a', 'done')]).size).toBe(0)
})
test('an exercise change does not pop: its sets are new ids', () => {
  expect(after([row('a', 'current')], [row('b', 'done')]).size).toBe(0)
})
test('an undo does not pop', () => {
  expect(after([row('a', 'done')], [row('a', 'current')]).size).toBe(0)
})
test('a set that stays done does not pop again', () => {
  expect(after([row('a', 'done')], [row('a', 'done')]).size).toBe(0)
})

// The Marker's own decision. A row that stops being open swaps its root, so the Marker remounts:
// its Reduce Motion flag starts from the flag memory, and its duration from that flag.
const IOS = { isReduceMotionEnabled: () => Promise.resolve(false) }
const PRESS = motionDuration('press', false)
const mountedMs = memory => motionDuration('press', memory.start(IOS, 'reduceMotion'))
const FULL_SIZE = { from: 1, ms: 0 }

test('a current set completed once the flag is known to allow motion: the remounted mark starts at 0 and grows', () => {
  const memory = flagMemory()
  memory.remember('reduceMotion', false)
  const pop = after([row('a', 'current')], [row('a', 'done')]).has('a')
  expect(PRESS).toBeGreaterThan(0)
  expect(donePop(false, pop, mountedMs(memory))).toEqual({ from: 0, ms: PRESS })
})
test('the flag not known yet (no read resolved): the mark is drawn full size and does not pop', () => {
  expect(donePop(false, true, mountedMs(flagMemory()))).toEqual(FULL_SIZE)
})
test('Reduce Motion on: the mark is drawn full size and does not pop', () => {
  const memory = flagMemory()
  memory.remember('reduceMotion', true)
  expect(donePop(false, true, mountedMs(memory))).toEqual(FULL_SIZE)
})
test('a duration that arrives after the mark was drawn full size never pops it (no full-size flash, then pop)', () => {
  expect(donePop(false, true, 0)).toEqual(FULL_SIZE)
  expect(donePop(true, true, PRESS)).toEqual(FULL_SIZE)
})
test('a mark already on screen pops when its set turns done', () => {
  expect(donePop(false, true, PRESS)).toEqual({ from: 0, ms: PRESS })
})
test('no pop: full size, still', () => {
  expect(donePop(false, false, PRESS)).toEqual(FULL_SIZE)
  expect(donePop(true, false, PRESS)).toEqual(FULL_SIZE)
  expect(donePop(undefined, false, PRESS)).toEqual(FULL_SIZE)
})
