import { describe, it, expect } from 'vitest'
import { rotationStreak, streakLoop, maxGapOf, defaultRoundDays, roundDaysOf } from './rotation-streak.js'

const R = ['a', 'b', 'c', 'd', 'e', 'f']
const day = n => { const d = new Date(2026, 0, 1 + n, 12); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') }
const wo = (n, id) => ({ d: day(n), routineIds: id ? [id] : [] })
const rot = (workouts, extra = {}) => ({
  routines: R.map(id => ({ id, name: id.toUpperCase() })),
  rotation: { id: 'rot', sequence: R, label: '' },
  queue: { ids: R, since: 0, startsOn: day(0), label: '', rotationId: 'rot' },
  scheduleMode: 'rotation', week: {}, workouts, ...extra,
})

describe('rotation streak rule', () => {
  it('derives the allowed gap from the loop', () => {
    expect(maxGapOf(14, 6)).toBe(5)
    expect(maxGapOf(7, 7)).toBe(3)
    expect(maxGapOf(7, 1)).toBe(14)
    expect(defaultRoundDays(6)).toBe(14)
    expect(defaultRoundDays(5)).toBe(7)
    expect(roundDaysOf({ roundDays: 10 }, 6)).toBe(10)
    expect(roundDaysOf({ roundDays: 9 }, 6)).toBe(14)
  })

  it('six routines over 14 days, workouts on days 0, 2, 4, 9: streak 4', () => {
    const s = rotationStreak(rot([wo(0, 'a'), wo(2, 'b'), wo(4, 'c'), wo(9, 'd')]), day(9))
    expect(s.maxGap).toBe(5)
    expect(s.count).toBe(4)
    expect(s.state).toBe('active')
  })

  it('a 7-day gap with no pass banked starts a new streak at 1', () => {
    const s = rotationStreak(rot([wo(0, 'a'), wo(2, 'b'), wo(4, 'c'), wo(9, 'd'), wo(16, 'e')]), day(16))
    expect(s.count).toBe(1)
    expect(s.best).toBe(4)
  })

  it('after a completed round the same 7-day gap spends a pass and the streak continues', () => {
    const round = R.map((id, i) => wo(i * 2, id))
    const before = rotationStreak(rot(round), day(10))
    expect(before.rounds).toBe(1)
    expect(before.passes).toBe(1)
    const s = rotationStreak(rot([...round, wo(17, 'a')]), day(17))
    expect(s.count).toBe(7)
    expect(s.passes).toBe(0)
    expect(s.state).toBe('active')
  })

  it('a sick pause from day 5 to day 12 freezes the clock, so day 13 continues', () => {
    const S = rot([wo(0, 'a'), wo(2, 'b'), wo(4, 'c'), wo(13, 'd')], { pauses: [{ kind: 'sick', since: day(5), until: day(12) }] })
    expect(rotationStreak(S, day(13)).count).toBe(4)
  })

  it('a running pause shows paused with the count frozen', () => {
    const S = rot([wo(0, 'a'), wo(2, 'b')], { status: { kind: 'sick', since: day(3) } })
    const s = rotationStreak(S, day(30))
    expect(s.state).toBe('paused')
    expect(s.count).toBe(2)
    expect(s.kind).toBe('sick')
  })

  it('off-rotation training adds nothing but resets the gap clock', () => {
    const s = rotationStreak(rot([wo(0, 'a'), wo(5, null), wo(10, 'b')]), day(10))
    expect(s.count).toBe(2)
  })

  it('two loop sessions on one day count once', () => {
    expect(rotationStreak(rot([wo(0, 'a'), wo(0, 'b')]), day(0)).count).toBe(1)
  })

  it('is at risk once the gap passes maxGap - 2, with the last safe day', () => {
    const S = rot([wo(0, 'a')])
    expect(rotationStreak(S, day(3)).state).toBe('active')
    const s = rotationStreak(S, day(4))
    expect(s.state).toBe('atRisk')
    expect(s.deadline).toBe(day(5))
  })

  it('is broken past the allowed gap, keeping the best', () => {
    const s = rotationStreak(rot([wo(0, 'a'), wo(2, 'b')]), day(9))
    expect(s.state).toBe('broken')
    expect(s.count).toBe(0)
    expect(s.best).toBe(2)
  })

  it('is zero before the first session, and ignores future-dated workouts', () => {
    expect(rotationStreak(rot([]), day(0)).state).toBe('zero')
    expect(rotationStreak(rot([wo(5, 'a')]), day(0)).state).toBe('zero')
  })

  it('banks at most two passes', () => {
    const rounds = [0, 1, 2].flatMap(r => R.map((id, i) => wo(r * 12 + i * 2, id)))
    expect(rotationStreak(rot(rounds), day(34)).passes).toBe(2)
  })

  it('does not let one pass cover a gap longer than twice maxGap', () => {
    const round = R.map((id, i) => wo(i * 2, id))
    expect(rotationStreak(rot([...round, wo(21, 'a')]), day(21)).count).toBe(1)
  })

  it('recomputes from any order of the log', () => {
    const ws = [wo(9, 'd'), wo(0, 'a'), wo(4, 'c'), wo(2, 'b')]
    expect(rotationStreak(rot(ws), day(9)).count).toBe(4)
  })

  it('sessions keep counting after the sequence is edited mid-streak', () => {
    const S = rot([wo(0, 'a'), wo(2, 'b'), wo(4, 'c')])
    S.rotation = { ...S.rotation, sequence: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }
    S.routines.push({ id: 'g', name: 'G' })
    expect(rotationStreak(S, day(4)).count).toBe(3)
  })
})

describe('streak loop', () => {
  it('has no loop without a rotation or a plan, so the caller falls back to weeks', () => {
    expect(streakLoop({ routines: [], week: {}, workouts: [] })).toBeNull()
    expect(rotationStreak({ routines: [], week: {}, workouts: [wo(0, null)] }, day(0))).toBeNull()
  })

  it('uses the planned weekdays in Fixed Week, P = 7', () => {
    const S = { routines: [{ id: 'a' }, { id: 'b' }], week: { 1: ['a'], 3: ['b'], 5: 'a' }, workouts: [] }
    expect(streakLoop(S)).toEqual({ mode: 'week', ids: ['a', 'b'], N: 3, P: 7 })
    expect(maxGapOf(7, 3)).toBe(5)
  })

  it('ignores deleted routines in the sequence', () => {
    const S = rot([])
    S.routines = S.routines.filter(r => r.id !== 'f')
    expect(streakLoop(S).N).toBe(5)
    expect(streakLoop(S).P).toBe(7)
  })

  it('treats a sequence of one as maxGap = 2P', () => {
    const S = rot([], { routines: [{ id: 'a' }] })
    S.rotation.sequence = ['a']; S.queue.ids = ['a']
    const l = streakLoop(S)
    expect(maxGapOf(l.P, l.N)).toBe(14)
  })
})
