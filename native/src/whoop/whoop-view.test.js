import { describe, expect, test } from 'vitest'
import { addDays } from '../ui/dates.js'
import { recoveryChartLabel, whoopCardView, WHOOP_TEXT } from './whoop-view.js'

// Local 3 pm on Nov 9, 2026, so "today" is 2026-11-09 in any zone the tests run in.
const NOW = new Date(2026, 10, 9, 15, 0).getTime()
const noon = d => {
  const [y, m, day] = d.split('-').map(Number)
  return new Date(y, m - 1, day, 12).getTime()
}
// Deterministic formatters: the time and the day of a moment, in UTC.
const formatTime = ms => `T${new Date(ms).toISOString().slice(11, 16)}`
const formatDay = ms => new Date(ms).toISOString().slice(0, 10)
const opts = (over = {}) => ({ paired: true, now: NOW, formatTime, formatDay, ...over })

const blank = d => ({ d, recovery: null, hrv: null, rhr: null, calibrating: false, strain: null })
// 14 days, newest first, from 2026-11-09; `over` maps a day to the values it has.
function days(over = {}) {
  return Array.from({ length: 14 }, (_, i) => {
    const d = addDays('2026-11-09', -i)
    return { ...blank(d), ...(over[d] || {}) }
  })
}
const workout = (start, over = {}) => ({ d: start.slice(0, 10), sport: 'running', start, minutes: 60, strain: 8.1, avgHr: 140, kcal: 500, ...over })
const connected = (over = {}) => ({ configured: true, connected: true, fetchedAt: '2026-11-09T12:00:00.000Z', stale: false, days: days(), workouts: [], ...over })

const NOTHING = { today: null, series: [], chartLabel: null, cardio: [], asOf: null, stale: false }

describe('the state of every server shape', () => {
  test('unpaired: the unpaired line, no button, and nothing shown even from a full payload', () => {
    const full = connected({ days: days({ '2026-11-09': { recovery: 67 } }), workouts: [workout('2026-11-09T07:00:00.000Z')] })
    for (const payload of [null, full]) {
      expect(whoopCardView(payload, opts({ paired: false }))).toEqual({
        state: 'unpaired', line: 'WHOOP shows here once this phone is paired with your server.', error: null, connected: false, ...NOTHING,
      })
    }
  })

  test('not configured on the server', () => {
    const v = whoopCardView({ configured: false, connected: false, fetchedAt: null, stale: false, days: [], workouts: [] }, opts())
    expect(v).toEqual({ state: 'unconfigured', line: "WHOOP isn't set up on your server yet.", error: null, connected: false, ...NOTHING })
  })

  test('not connected: the connect line, and the button says Connect WHOOP', () => {
    const v = whoopCardView({ configured: true, connected: false, fetchedAt: null, stale: false, days: [], workouts: [] }, opts())
    expect(v).toEqual({ state: 'disconnected', line: 'Connect WHOOP to see recovery, strain and cardio here.', error: null, connected: false, ...NOTHING })
    expect(WHOOP_TEXT.connect).toBe('Connect WHOOP')
  })

  test('a Connect link on another address than the paired one says where to pair', () => {
    expect(WHOOP_TEXT.pairedElsewhere('gym.example.com')).toBe('Connect works when this phone is paired with gym.example.com. Forget the server and pair again at that address.')
    expect(WHOOP_TEXT.pairedElsewhere('https://gym.example.com')).toBe('Connect works when this phone is paired with https://gym.example.com. Forget the server and pair again at that address.')
  })

  test('connected with nothing scored: 14 empty days and no workouts is empty, with Disconnect', () => {
    const v = whoopCardView(connected(), opts())
    expect(v).toEqual({ state: 'empty', line: WHOOP_TEXT.empty, error: null, connected: true, ...NOTHING })
  })

  test("WHOOP unavailable with nothing cached is the error line, still connected", () => {
    const v = whoopCardView({ configured: true, connected: true, fetchedAt: null, stale: false, days: [], workouts: [], error: 'unavailable' }, opts())
    expect(v).toEqual({ state: 'empty', line: "Couldn't reach WHOOP. Try again later.", error: "Couldn't reach WHOOP. Try again later.", connected: true, ...NOTHING })
  })

  test('an error payload that still carries data is ready', () => {
    const v = whoopCardView(connected({ error: 'unavailable', days: days({ '2026-11-09': { recovery: 50 } }) }), opts())
    expect(v.state).toBe('ready')
    expect(v.error).toBeNull()
  })

  test('paired with no payload at all (the server was not reached, nothing cached): the plain server line', () => {
    for (const payload of [null, undefined, 'x', [], { configured: true }]) {
      expect(whoopCardView(payload, opts())).toEqual({
        state: 'empty', line: "Couldn't reach your server. Try again later.", error: "Couldn't reach your server. Try again later.", connected: false, ...NOTHING,
      })
    }
  })

  test('workouts with no scored day are ready, with no today lines', () => {
    const v = whoopCardView(connected({ workouts: [workout('2026-11-08T07:00:00.000Z')] }), opts())
    expect(v.state).toBe('ready')
    expect(v.line).toBeNull()
    expect(v.today).toBeNull()
    expect(v.series).toEqual([])
    expect(v.cardio).toHaveLength(1)
  })
})

describe("today's lines", () => {
  test('recovery %, HRV ms, resting HR bpm and strain to one decimal, titled Today', () => {
    const v = whoopCardView(connected({ days: days({ '2026-11-09': { recovery: 67, hrv: 55.5, rhr: 52, strain: 12.34 } }) }), opts())
    expect(v.state).toBe('ready')
    expect(v.line).toBeNull()
    expect(v.today).toEqual({
      d: '2026-11-09', title: 'Today', calibrating: false, recovery: '67%', hrv: '56 ms', rhr: '52 bpm', strain: '12.3',
      rows: [
        { key: 'recovery', label: 'Recovery', value: '67%', a11y: 'Recovery, 67%' },
        { key: 'hrv', label: 'HRV', value: '56 ms', a11y: 'HRV, 56 milliseconds' },
        { key: 'rhr', label: 'Resting HR', value: '52 bpm', a11y: 'Resting heart rate, 52 beats per minute' },
        { key: 'strain', label: 'Strain', value: '12.3', a11y: 'Strain, 12.3' },
      ],
    })
  })

  test('today is the newest day with any value, and shows its date when it is not today', () => {
    const v = whoopCardView(connected({ days: days({ '2026-11-08': { strain: 4 }, '2026-11-07': { recovery: 90 } }) }), opts())
    expect(v.today.d).toBe('2026-11-08')
    expect(v.today.title).toBe('Nov 8')
    expect([v.today.recovery, v.today.hrv, v.today.rhr, v.today.strain]).toEqual(['–', '–', '–', '4.0'])
  })

  test('a dash for null, never 0; and the dash is never read out', () => {
    const v = whoopCardView(connected({ days: days({ '2026-11-09': { strain: 3 } }) }), opts())
    expect(v.today.rows.map(r => r.value)).toEqual(['–', '–', '–', '3.0'])
    for (const r of v.today.rows) expect(r.a11y).not.toContain('–')
    expect(v.today.rows[0].a11y).toBe('Recovery, no reading')
  })

  test('zero shows 0, and a day of zeros counts as a day with values', () => {
    const v = whoopCardView(connected({ days: days({ '2026-11-09': { recovery: 0, hrv: 0, rhr: 0, strain: 0 } }) }), opts())
    expect(v.today.d).toBe('2026-11-09')
    expect([v.today.recovery, v.today.hrv, v.today.rhr, v.today.strain]).toEqual(['0%', '0 ms', '0 bpm', '0.0'])
  })

  test('strain to one decimal', () => {
    const strainOf = s => whoopCardView(connected({ days: days({ '2026-11-09': { strain: s } }) }), opts()).today.strain
    expect([strainOf(12.34), strainOf(8.46), strainOf(21), strainOf(7), strainOf(0.04)]).toEqual(['12.3', '8.5', '21.0', '7.0', '0.0'])
    // Halves round up, as the app's num() rounds (toFixed alone gives 8.4 for 8.45).
    expect([strainOf(8.45), strainOf(1.45), strainOf(0.05), strainOf(-0.01)]).toEqual(['8.5', '1.5', '0.1', '0.0'])
  })

  test('calibrating shows on recovery, with or without a score', () => {
    const none = whoopCardView(connected({ days: days({ '2026-11-09': { hrv: 40, calibrating: true } }) }), opts())
    expect(none.today.calibrating).toBe(true)
    expect(none.today.rows[0]).toEqual({ key: 'recovery', label: 'Recovery', value: 'Calibrating', a11y: 'Recovery, calibrating' })
    const some = whoopCardView(connected({ days: days({ '2026-11-09': { recovery: 40, calibrating: true } }) }), opts())
    expect(some.today.rows[0]).toEqual({ key: 'recovery', label: 'Recovery', value: '40% · calibrating', a11y: 'Recovery, 40%, calibrating' })
  })

  test('days out of order still pick the newest', () => {
    const rows = days({ '2026-11-09': { recovery: 10 }, '2026-11-05': { recovery: 20 } }).reverse()
    expect(whoopCardView(connected({ days: rows }), opts()).today.d).toBe('2026-11-09')
  })
})

describe('the 7-day recovery series', () => {
  test("the last 7 days' recovery, oldest first, skipping nulls, at local noon", () => {
    const v = whoopCardView(connected({
      days: days({
        '2026-11-09': { recovery: 67 },
        '2026-11-08': { strain: 5 }, // no recovery: skipped
        '2026-11-06': { recovery: 0 }, // zero is a value
        '2026-11-03': { recovery: 45 }, // the 7th day back counts
        '2026-11-02': { recovery: 99 }, // the 8th does not
      }),
    }), opts())
    expect(v.series).toEqual([
      { t: noon('2026-11-03'), y: 45, d: '2026-11-03' },
      { t: noon('2026-11-06'), y: 0, d: '2026-11-06' },
      { t: noon('2026-11-09'), y: 67, d: '2026-11-09' },
    ])
    expect(v.chartLabel).toBe('Recovery for 3 of the last 7 days: lowest 0%, highest 67%, latest 67% on Nov 9.')
  })

  test('the window ends at the newest day sent, so a cached read keeps its own week', () => {
    const rows = days({ '2026-11-09': { recovery: 1 } }).map(r => ({ ...r, d: addDays(r.d, -3) }))
    rows[0].recovery = 70
    const v = whoopCardView(connected({ days: rows }), opts())
    expect(v.series.map(p => p.d)).toEqual(['2026-11-06'])
  })

  test('no recovery in the week: no series and no label', () => {
    const v = whoopCardView(connected({ days: days({ '2026-11-09': { strain: 5 } }) }), opts())
    expect(v.series).toEqual([])
    expect(v.chartLabel).toBeNull()
  })

  test('the label is one sentence: one day, every day, and none', () => {
    const at = d => ({ t: noon(d), y: 0, d })
    expect(recoveryChartLabel([{ ...at('2026-11-08'), y: 52 }], { now: NOW })).toBe('Recovery for 1 of the last 7 days: 52% on Nov 8.')
    const week = Array.from({ length: 7 }, (_, i) => ({ ...at(addDays('2026-11-03', i)), y: 40 + i }))
    expect(recoveryChartLabel(week, { now: NOW })).toBe('Recovery for the last 7 days: lowest 40%, highest 46%, latest 46% on Nov 9.')
    expect(recoveryChartLabel([], { now: NOW })).toBeNull()
  })
})

describe('recent cardio', () => {
  test('the newest 5, newest first, with sport, date, minutes, strain, average HR and kcal', () => {
    const list = Array.from({ length: 7 }, (_, i) => workout(`2026-11-0${9 - i}T07:00:00.000Z`, { minutes: 30 + i }))
    const v = whoopCardView(connected({ workouts: [...list].reverse() }), opts())
    expect(v.cardio).toHaveLength(5)
    expect(v.cardio.map(c => c.date)).toEqual(['Nov 9', 'Nov 8', 'Nov 7', 'Nov 6', 'Nov 5'])
    expect(v.cardio[0]).toEqual({
      key: '2026-11-09T07:00:00.000Z', sport: 'Running', date: 'Nov 9',
      minutes: '30 min', strain: '8.1', avgHr: '140 bpm', kcal: '500 kcal',
      line: '30 min · Strain 8.1 · Avg HR 140 bpm · 500 kcal',
      a11y: 'Running, Nov 9: 30 minutes, strain 8.1, average heart rate 140 beats per minute, 500 kilocalories',
    })
  })

  test('an unscored workout shows dashes for strain, average HR and kcal, and keeps its minutes', () => {
    const v = whoopCardView(connected({ workouts: [workout('2026-11-09T07:00:00.000Z', { sport: 'Workout', minutes: 30, strain: null, avgHr: null, kcal: null })] }), opts())
    const c = v.cardio[0]
    expect([c.sport, c.minutes, c.strain, c.avgHr, c.kcal]).toEqual(['Workout', '30 min', '–', '–', '–'])
    expect(c.line).toBe('30 min · Strain – · Avg HR – · – kcal')
    expect(c.a11y).toBe('Workout, Nov 9: 30 minutes, strain not scored, average heart rate not scored, kilocalories not scored')
  })

  test('zeros show 0, kcal is rounded with a thousands separator, minutes are whole', () => {
    const v = whoopCardView(connected({
      workouts: [
        workout('2026-11-09T07:00:00.000Z', { minutes: 0, strain: 0, avgHr: 0, kcal: 0 }),
        workout('2026-11-08T07:00:00.000Z', { minutes: 47.6, kcal: 1234.5 }),
        workout('2026-11-07T07:00:00.000Z', { kcal: 499.4, minutes: null }),
      ],
    }), opts())
    expect(v.cardio.map(c => [c.minutes, c.strain, c.avgHr, c.kcal])).toEqual([
      ['0 min', '0.0', '0 bpm', '0 kcal'],
      ['48 min', '8.1', '140 bpm', '1,235 kcal'],
      ['–', '8.1', '140 bpm', '499 kcal'],
    ])
    expect(v.cardio[2].line).toBe('– min · Strain 8.1 · Avg HR 140 bpm · 499 kcal')
  })

  test('sports read in sentence case; keys stay unique when two start together', () => {
    const v = whoopCardView(connected({
      workouts: [
        workout('2026-11-09T07:00:00.000Z', { sport: 'strength training' }),
        workout('2026-11-09T07:00:00.000Z', { sport: '' }),
        workout('2025-12-30T07:00:00.000Z', { sport: 42 }),
      ],
    }), opts())
    expect(v.cardio.map(c => c.sport)).toEqual(['Strength training', 'Workout', 'Workout'])
    expect(v.cardio.map(c => c.key)).toEqual(['2026-11-09T07:00:00.000Z', '2026-11-09T07:00:00.000Z#1', '2025-12-30T07:00:00.000Z'])
    expect(v.cardio[2].date).toBe('Dec 30, 2025')
  })
})

describe('as of', () => {
  test('a fresh read has no as-of line', () => {
    const v = whoopCardView(connected({ days: days({ '2026-11-09': { recovery: 1 } }) }), opts())
    expect(v.asOf).toBeNull()
    expect(v.stale).toBe(false)
  })

  test("a stale read says when it was fetched: the time alone on today's date", () => {
    const v = whoopCardView(connected({ stale: true, fetchedAt: '2026-11-09T09:41:00.000Z', days: days({ '2026-11-09': { recovery: 1 } }) }),
      opts({ now: Date.parse('2026-11-09T15:00:00.000Z') }))
    expect(v.asOf).toBe('As of T09:41')
    expect(v.stale).toBe(true)
  })

  test('a read from the phone cache says when it was fetched, with the day when it is not today', () => {
    const v = whoopCardView(connected({ fetchedAt: '2026-11-08T09:41:00.000Z', days: days({ '2026-11-09': { recovery: 1 } }) }),
      opts({ cached: true, now: Date.parse('2026-11-09T15:00:00.000Z') }))
    expect(v.asOf).toBe('As of 2026-11-08, T09:41')
    expect(v.stale).toBe(true)
  })

  test('an empty cached read still says as of; a stale read with no time says nothing', () => {
    expect(whoopCardView(connected({ fetchedAt: '2026-11-09T09:41:00.000Z' }), opts({ cached: true, now: Date.parse('2026-11-09T15:00:00.000Z') })).asOf).toBe('As of T09:41')
    expect(whoopCardView(connected({ stale: true, fetchedAt: null, days: days({ '2026-11-09': { recovery: 1 } }) }), opts()).asOf).toBeNull()
  })

  test("a stale or cached read with no fetchedAt says as of when the phone saved it", () => {
    const savedAt = Date.parse('2026-11-09T08:05:00.000Z')
    const now = Date.parse('2026-11-09T15:00:00.000Z')
    const read = connected({ fetchedAt: null, days: days({ '2026-11-09': { recovery: 1 } }) })
    expect(whoopCardView(read, opts({ cached: true, savedAt, now })).asOf).toBe('As of T08:05')
    expect(whoopCardView({ ...read, stale: true }, opts({ savedAt, now })).asOf).toBe('As of T08:05')
    // fetchedAt, when there is one, is when WHOOP was read: it wins.
    expect(whoopCardView({ ...read, fetchedAt: '2026-11-09T07:00:00.000Z' }, opts({ cached: true, savedAt, now })).asOf).toBe('As of T07:00')
    // A fresh read never says as of, whatever savedAt says.
    expect(whoopCardView(read, opts({ savedAt, now })).asOf).toBeNull()
  })

  test('the default formatters give a time', () => {
    const v = whoopCardView(connected({ stale: true, days: days({ '2026-11-09': { recovery: 1 } }) }), { paired: true, now: NOW })
    expect(v.asOf).toMatch(/^As of .*\d/)
  })
})
