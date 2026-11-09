import { describe, expect, test } from 'vitest'
import { applyMeasurementOps } from './measurement-ops.js'
import { createMemoryMeasurements } from './measurement-store.js'
import { applyLogForm, fieldChoices, fieldView } from './measurement-view.js'
import {
  historyList, latestView, logDraft, logValues, measurementChartLabel, measurementSaveArgs, pickField,
} from './measurement-screen.js'

const NOW = new Date(2026, 10, 9, 12).getTime()
const TODAY = '2026-11-09'
const IN = 2.54
// Waist 81.28 cm = 32 in; chest 101.6 cm = 40 in.
const entry = (d, t, extra = {}) => ({ d, t, waist: 81.28, chest: 101.6, ...extra })

describe('pickField (Measurements.jsx fallback: waist, else the first)', () => {
  const choices = [{ key: 'neck' }, { key: 'waist' }, { key: 'bodyFat' }]
  test('the chosen field while it is offered, else waist, else the first, else none', () => {
    expect(pickField(choices, 'bodyFat')).toBe('bodyFat')
    expect(pickField(choices, 'gone')).toBe('waist')
    expect(pickField(choices, null)).toBe('waist')
    expect(pickField([{ key: 'neck' }, { key: 'hips' }], null)).toBe('neck')
    expect(pickField([], 'waist')).toBeNull()
  })
})

describe('latestView (Measurements.jsx card head)', () => {
  test('the latest in inches and the change since the previous one', () => {
    const state = { measurements: [entry('2026-11-01', 1), entry(TODAY, 2, { waist: 82.55 })] }
    expect(latestView(fieldView(state, 'waist', { range: 0, now: NOW }))).toEqual({
      label: 'Waist', value: '32.5 in', change: '+0.5 in since previous',
    })
  })

  test('a fall reads with a minus; no change, or one reading, shows no change line', () => {
    const down = { measurements: [entry('2026-11-01', 1, { waist: 82.55 }), entry(TODAY, 2)] }
    expect(latestView(fieldView(down, 'waist', { now: NOW })).change).toBe('-0.5 in since previous')
    const same = { measurements: [entry('2026-11-01', 1), entry(TODAY, 2)] }
    expect(latestView(fieldView(same, 'waist', { now: NOW })).change).toBeNull()
    const one = { measurements: [entry(TODAY, 2)] }
    expect(latestView(fieldView(one, 'waist', { now: NOW }))).toEqual({ label: 'Waist', value: '32 in', change: null })
  })

  test('body fat is a percent; nothing logged is a dash; no field is the screen\'s name', () => {
    const fat = { measurements: [{ d: TODAY, t: 1, bodyFat: 18.5 }] }
    expect(latestView(fieldView(fat, 'bodyFat', { now: NOW })).value).toBe('18.5 %')
    expect(latestView(fieldView({}, 'waist', { now: NOW }))).toEqual({ label: 'Waist', value: '–', change: null })
    expect(latestView(null)).toEqual({ label: 'Body measurements', value: '–', change: null })
  })
})

describe('measurementChartLabel (one sentence for the chart image)', () => {
  test('the field, the range and the latest reading', () => {
    const state = { measurements: [entry('2026-11-01', 1), entry(TODAY, 2, { waist: 82.55 })] }
    const view = fieldView(state, 'waist', { range: 90, now: NOW })
    expect(measurementChartLabel(view, 90, { now: NOW })).toBe('Waist, last 90 days: latest 32.5 in on Nov 9')
    expect(measurementChartLabel(view, 0, { now: NOW })).toBe('Waist, all time: latest 32.5 in on Nov 9')
    expect(measurementChartLabel(fieldView({}, 'waist', { now: NOW }), 30, { now: NOW })).toBe('Waist, last 30 days')
  })
})

describe('historyList (Measurements.jsx history rows)', () => {
  test('each day with its count, a preview line in inches and the Edit and Delete labels', () => {
    const state = { measurements: [entry('2025-12-31', 1), entry(TODAY, 2, { bodyFat: 18 })] }
    expect(historyList(state, { now: NOW })).toEqual([
      expect.objectContaining({ d: TODAY, label: 'Nov 9', countLine: '3 measurements', previewLine: 'Chest 40 in · Waist 32 in', editLabel: 'Edit Nov 9', deleteLabel: 'Delete Nov 9' }),
      expect.objectContaining({ d: '2025-12-31', label: 'Dec 31, 2025', countLine: '2 measurements', previewLine: 'Chest 40 in · Waist 32 in' }),
    ])
  })

  test('none gives none', () => {
    expect(historyList({}, { now: NOW })).toEqual([])
  })
})

describe('logDraft (Measurements.jsx MeasurementLog)', () => {
  const state = { measurements: [entry(TODAY, 2, { bodyFat: 18 })] }

  test('Log: the enabled fields, empty, whatever the day holds (the web\'s Log has no source day)', () => {
    const d = logDraft(state, TODAY, { edit: false })
    expect(d).toMatchObject({ d: TODAY, editing: false, title: 'Log measurements' })
    expect(d.fields.map(f => f.key)).toEqual(fieldChoices({}).map(f => f.key))
    expect(Object.values(d.text).every(t => t === '')).toBe(true)
    expect(Object.values(d.opened).every(v => v === null)).toBe(true)
  })

  test('Edit: the day\'s values in inches as text, its populated disabled fields too', () => {
    const d = logDraft(state, TODAY, { edit: true })
    expect(d).toMatchObject({ editing: true, title: 'Edit measurements' })
    expect(d.text.waist).toBe('32')
    expect(d.text.chest).toBe('40')
    expect(d.text.bodyFat).toBe('18')
    expect(d.text.neck).toBe('')
    expect(d.opened.waist).toBe(32)
  })
})

describe('logValues: only what the owner changed counts as typed', () => {
  test('a field typed differently is the typed number; one left alone is the value the day holds now', () => {
    const opened = { waist: 32, chest: 40, neck: null }
    const text = { waist: '32.0', chest: '41', neck: '' }
    const latest = { waist: 32.5, chest: 40, neck: null }
    expect(logValues({ opened, text, latest })).toEqual({ waist: 32.5, chest: 41, neck: null })
  })

  test('a cleared field is null; a comma is a decimal point', () => {
    expect(logValues({ opened: { waist: 32 }, text: { waist: '' }, latest: { waist: 32 } })).toEqual({ waist: null })
    expect(logValues({ opened: { waist: null }, text: { waist: '33,5' }, latest: {} })).toEqual({ waist: 33.5 })
  })

  // A sync that brought a web change to an untouched field while the sheet was open keeps it: the
  // log is built on the day as it is now and changes only the touched field.
  test('with applyLogForm: a web change to an untouched field survives byte for byte', () => {
    const opened = { d: TODAY, t: 2, waist: 81.28, chest: 101.6 }
    const before = { measurements: [opened] }
    const draft = logDraft(before, TODAY, { edit: true })
    const now = { measurements: [{ ...opened, t: 5, chest: 102.3 }] }
    const text = { ...draft.text, waist: '33' }
    const values = logValues({ opened: draft.opened, text, latest: logDraft(now, TODAY, { edit: true }).opened })
    const out = applyLogForm(now, TODAY, { values, editing: true }, { now: NOW })
    expect(out.error).toBeNull()
    expect(out.entry.chest).toBe(102.3)
    expect(out.entry.waist).toBe(Math.round(33 * IN * 10) / 10)
  })
})

describe('measurementSaveArgs: what a measurement save puts in the store', () => {
  test('a set is the entry applyLogForm built, under its own d and t', () => {
    const e = entry(TODAY, 1234)
    expect(measurementSaveArgs({ copy: null, bundled: { state: {} } }, { op: 'set', entry: e }, { now: NOW }))
      .toEqual({ d: TODAY, op: 'set', entry: e, t: 1234 })
  })

  test("a remove's baseT is the copy's own entry t, never this phone's unsent one laid over it", () => {
    const copy = { state: { measurements: [entry(TODAY, 50)] } }
    expect(measurementSaveArgs({ copy, bundled: { state: {} } }, { op: 'remove', d: TODAY }, { now: NOW }))
      .toEqual({ d: TODAY, op: 'remove', t: NOW, baseT: 50 })
    expect(measurementSaveArgs({ copy, bundled: { state: {} } }, { op: 'remove', d: '2026-11-01' }, { now: NOW }).baseT).toBeNull()
  })

  test('no copy held: the snapshot is the base', () => {
    const bundled = { state: { measurements: [entry(TODAY, 7)] } }
    expect(measurementSaveArgs({ copy: null, bundled }, { op: 'remove', d: TODAY }, { now: NOW }).baseT).toBe(7)
    expect(measurementSaveArgs({ copy: null, bundled: { state: {} } }, { op: 'remove', d: TODAY }, { now: NOW }).baseT).toBeNull()
  })

  test('anything else is a programming error', () => {
    expect(() => measurementSaveArgs({ copy: null, bundled: {} }, { op: 'move', d: TODAY }, { now: NOW })).toThrow()
  })

  test('through the store and the guard: a remove over this phone\'s unsent set takes the copy\'s day out', async () => {
    const copy = { state: { measurements: [entry(TODAY, 50)], deleted: { measurements: {} } } }
    const store = createMemoryMeasurements()
    // An edit of the day, not yet sent: the screen shows it over the copy.
    const shown = { measurements: applyMeasurementOps(copy.state.measurements, [], {}).next }
    const set = applyLogForm(shown, TODAY, { values: { waist: 33 }, editing: true }, { now: NOW }).entry
    await store.put(measurementSaveArgs({ copy, bundled: {} }, { op: 'set', entry: set }, { now: NOW }))
    const pendingSet = await store.listPending()
    expect(applyMeasurementOps(copy.state.measurements, pendingSet, {}).applied).toEqual([{ d: TODAY, t: set.t }])

    await store.put(measurementSaveArgs({ copy, bundled: {} }, { op: 'remove', d: TODAY }, { now: NOW + 1 }))
    const pending = await store.listPending()
    expect(pending[0]).toMatchObject({ op: 'remove', baseT: 50 })
    const out = applyMeasurementOps(copy.state.measurements, pending, {})
    expect(out.applied).toEqual([{ d: TODAY, t: NOW + 1 }])
    expect(out.next).toEqual([])
  })
})
