import { describe, expect, test } from 'vitest'
import { applyLogForm, fieldChoices, fieldView, historyRows, logForm, removeOp } from './measurement-view.js'

const NOW = new Date('2026-11-09T15:00:00').getTime()
const D = '2026-11-09'

describe('fieldChoices (measurements.js enabledMeasurementFields)', () => {
  test('lists the enabled fields in table order with labels, then enabled custom ones', () => {
    const state = { measurementEnabled: ['waist', 'neck', 'bodyFat'], customMeasurements: [{ id: 'c1', name: 'Bicep flex', enabled: true }] }
    expect(fieldChoices(state).map(f => [f.key, f.label, f.unit])).toEqual([
      ['neck', 'Neck', 'in'], ['waist', 'Waist', 'in'], ['bodyFat', 'Body fat', '%'], ['other:c1', 'Bicep flex', 'in'],
    ])
  })
  test('a missing list and missing settings give the default fields, no crash', () => {
    const keys = fieldChoices({}).map(f => f.key)
    expect(keys).toContain('waist')
    expect(keys).not.toContain('bodyFat')
    expect(fieldChoices(undefined).length).toBe(keys.length)
  })
  test('(Measurements.jsx available) a disabled field with a logged value is still offered', () => {
    const state = { measurementEnabled: ['waist'], measurements: [{ d: '2026-01-01', t: 1, neck: 40 }] }
    expect(fieldChoices(state).map(f => f.key)).toEqual(['waist', 'neck'])
  })
})

describe('fieldView (measurements.js measurementSeries, Measurements.jsx latest/delta)', () => {
  const state = {
    measurements: [
      { d: '2026-09-01', t: 1, waist: 91.44 }, // 36 in
      { d: '2026-10-01', t: 2, waist: 88.9 }, // 35 in
      { d: '2026-11-01', t: 3, waist: 86.36, bodyFat: 18.5 }, // 34 in
    ],
  }
  test('series in inches, latest, and the change since the previous reading', () => {
    const v = fieldView(state, 'waist', { range: 0, now: NOW })
    expect(v.label).toBe('Waist')
    expect(v.unit).toBe('in')
    expect(v.series.map(p => [p.d, p.y])).toEqual([['2026-09-01', 36], ['2026-10-01', 35], ['2026-11-01', 34]])
    expect(v.series[0]).toEqual(expect.objectContaining({ t: expect.any(Number), d: '2026-09-01', y: 36 }))
    expect(v.latest).toEqual({ value: 34, d: '2026-11-01' })
    expect(v.change).toBe(-1)
  })
  test('range cuts the series but the latest and change still read the whole history', () => {
    const v = fieldView(state, 'waist', { range: 30, now: NOW })
    expect(v.series.map(p => p.d)).toEqual(['2026-11-01'])
    expect(v.latest.value).toBe(34)
    expect(v.change).toBe(-1)
  })
  test('body fat is a percent, not converted', () => {
    const v = fieldView(state, 'bodyFat', { now: NOW })
    expect(v.unit).toBe('%')
    expect(v.latest.value).toBe(18.5)
    expect(v.change).toBeNull()
  })
  test('a custom field reads its other value, labelled by the definition', () => {
    const s = { customMeasurements: [{ id: 'c1', name: 'Neck relaxed' }], measurements: [{ d: '2026-11-01', t: 1, other: [{ id: 'c1', value: 25.4 }] }] }
    const v = fieldView(s, 'other:c1', { now: NOW })
    expect(v.label).toBe('Neck relaxed')
    expect(v.latest.value).toBe(10)
  })
  test('no list, or no readings: empty, no NaN', () => {
    for (const s of [{}, { measurements: [] }, undefined, { measurements: 'x' }]) {
      const v = fieldView(s, 'waist', { range: 90, now: NOW })
      expect(v).toEqual({ key: 'waist', label: 'Waist', unit: 'in', latest: null, change: null, series: [] })
    }
  })
})

describe('logForm (Measurements.jsx MeasurementLog: values state, extra populated fields)', () => {
  test('a new day is an empty draft of the enabled fields', () => {
    const f = logForm({ measurementEnabled: ['waist', 'bodyFat'] }, D)
    expect(f.editing).toBe(false)
    expect(f.fields.map(x => x.key)).toEqual(['waist', 'bodyFat'])
    expect(f.values).toEqual({ waist: null, bodyFat: null })
  })
  test('an existing day shows inches, percent and custom values, and a populated disabled field', () => {
    const s = {
      measurementEnabled: ['waist', 'bodyFat'], customMeasurements: [{ id: 'c1', name: 'Calf flex' }],
      measurements: [{ d: D, t: 1, waist: 81.28, bodyFat: 17.2, neck: 38.1, other: [{ id: 'c1', value: 38.1 }] }],
    }
    const f = logForm(s, D)
    expect(f.editing).toBe(true)
    expect(f.values).toEqual({ waist: 32, bodyFat: 17.2, 'other:c1': 15, neck: 15 })
  })
  test('a missing list never gives NaN', () => {
    expect(JSON.stringify(logForm({}, D))).not.toMatch(/NaN|null.*undefined/)
    expect(logForm(undefined, D).editing).toBe(false)
  })
})

describe('applyLogForm', () => {
  test('inches in, cm out, rounded to 0.1 (measurements.js fromMeasurementDisplay)', () => {
    const { entry, error } = applyLogForm({}, D, { values: { waist: 33.5, neck: 15.25 } }, { now: NOW })
    expect(error).toBeNull()
    expect(entry.waist).toBe(85.1) // 33.5 * 2.54 = 85.09
    expect(entry.neck).toBe(38.9) // 15.3 (typed value rounds to 0.1 first, Measurements.jsx save) * 2.54 = 38.862
    expect(entry.d).toBe(D)
    expect(entry.t).toBe(NOW)
  })
  test('body fat is a percent, written as typed to 0.1', () => {
    expect(applyLogForm({}, D, { values: { bodyFat: 17.26 } }, { now: NOW }).entry.bodyFat).toBe(17.3)
  })
  test('body fat over 100 becomes null (normalizeMeasurementEntry)', () => {
    const { entry } = applyLogForm({}, D, { values: { waist: 32, bodyFat: 120 } }, { now: NOW })
    expect(entry.bodyFat).toBeNull()
    expect(applyLogForm({}, D, { values: { bodyFat: 120 } }, { now: NOW }).error).toBe('Enter at least one measurement')
  })
  test('an untouched field keeps its exact stored cm, an unknown key survives, only the changed field moves', () => {
    const s = { measurements: [{ d: D, t: 100, waist: 81.28, chest: 99.123, hips: 90, future: { a: 1 }, other: [{ id: 'zz', name: 'Gone', value: 7.77 }] }] }
    const form = logForm(s, D)
    form.values.hips = 36 // changed from 35.4
    const { entry, error } = applyLogForm(s, D, form, { now: NOW })
    expect(error).toBeNull()
    expect(entry.waist).toBe(81.28)
    expect(entry.chest).toBe(99.123)
    expect(entry.hips).toBe(91.4)
    expect(entry.future).toEqual({ a: 1 })
    expect(entry.other).toEqual([{ id: 'zz', name: 'Gone', value: 7.77 }])
  })
  test('two stored rows of a day fold into one entry (measurements.js mergeMeasurementEntries), keeping every key', () => {
    const s = { measurements: [
      { d: D, t: 10, waist: 80, chest: 100, early: 1 },
      { d: D, t: 20, waist: 81.28, chest: null, hips: 90, late: 2 },
    ] }
    const form = logForm(s, D)
    form.values.neck = 15
    const { entry } = applyLogForm(s, D, form, { now: NOW })
    expect(entry.waist).toBe(81.28) // the later row wins
    expect(entry.chest).toBe(100) // its empty field keeps the earlier value
    expect(entry.hips).toBe(90)
    expect(entry.neck).toBe(38.1)
    expect(entry.early).toBe(1)
    expect(entry.late).toBe(2)
  })
  test('clearing a changed field writes null; a custom field is written into other', () => {
    const s = { customMeasurements: [{ id: 'c1', name: 'Flex' }], measurements: [{ d: D, t: 1, waist: 81.28, neck: 38.1 }] }
    const form = logForm(s, D)
    form.values.waist = null
    form.values['other:c1'] = 10
    const { entry } = applyLogForm(s, D, form, { now: NOW })
    expect(entry.waist).toBeNull()
    expect(entry.neck).toBe(38.1)
    expect(entry.other).toEqual([{ id: 'c1', name: 'Flex', value: 25.4 }])
  })
  test('it needs at least one value (Measurements.jsx: "Enter at least one measurement")', () => {
    expect(applyLogForm({}, D, { values: {} }, { now: NOW })).toEqual({ entry: null, error: 'Enter at least one measurement' })
    expect(applyLogForm({}, D, { values: { waist: 0, neck: null } }, { now: NOW }).error).toBe('Enter at least one measurement')
    const s = { measurements: [{ d: D, t: 1, waist: 81.28 }] }
    expect(applyLogForm(s, D, { editing: true, values: { waist: null } }, { now: NOW }).error).toBe('Enter at least one measurement')
  })
  test('a day that already has an entry is refused when creating (Measurements.jsx save)', () => {
    const s = { measurements: [{ d: D, t: 1, waist: 81.28 }] }
    expect(applyLogForm(s, D, { values: { neck: 15 } }, { now: NOW })).toEqual({ entry: null, error: 'That date already has measurements. Edit it instead.' })
    expect(applyLogForm(s, D, { editing: true, values: { neck: 15 } }, { now: NOW }).error).toBeNull()
  })
  test('a bad or future date is refused (Measurements.jsx save: "Choose a valid date")', () => {
    for (const d of ['2026-11-10', 'nope', '', undefined]) {
      expect(applyLogForm({}, d, { values: { waist: 32 } }, { now: NOW }).error).toBe('Choose a valid date')
    }
  })
  test('the stamp is the weigh-in saveOp floor: now, the shown entry t + 1, the deletion stamp + 1', () => {
    const s = { measurements: [{ d: D, t: NOW + 5000, waist: 81.28 }], deleted: { measurements: { [D]: NOW + 2000 } } }
    expect(applyLogForm(s, D, { editing: true, values: { neck: 15 } }, { now: NOW }).entry.t).toBe(NOW + 5001)
    const gone = { deleted: { measurements: { [D]: NOW + 9000 } } }
    expect(applyLogForm(gone, D, { values: { neck: 15 } }, { now: NOW }).entry.t).toBe(NOW + 9001)
    expect(applyLogForm({ deleted: { measurements: { [D]: 5 } } }, D, { values: { neck: 15 } }, { now: NOW }).entry.t).toBe(NOW)
  })
  test('the state is never mutated', () => {
    const s = { measurements: [{ d: D, t: 1, waist: 81.28 }] }
    const copy = JSON.stringify(s)
    applyLogForm(s, D, { editing: true, values: { waist: 40 } }, { now: NOW })
    expect(JSON.stringify(s)).toBe(copy)
  })
})

describe('removeOp', () => {
  test('baseT is the copy\'s own entry t for the day, or null', () => {
    const copy = { measurements: [{ d: D, t: 77, waist: 1 }, { d: '2026-11-08', t: 5, waist: 1 }] }
    expect(removeOp(copy, D, { now: NOW })).toEqual({ d: D, op: 'remove', t: NOW, baseT: 77 })
    expect(removeOp(copy, '2026-01-01', { now: NOW })).toEqual({ d: '2026-01-01', op: 'remove', t: NOW, baseT: null })
    expect(removeOp({}, D, { now: NOW }).baseT).toBeNull()
  })
  test('with two rows on the day, baseT is the larger t (the row the guard reads)', () => {
    const copy = { measurements: [{ d: D, t: 90, waist: 1 }, { d: D, t: 40, neck: 1 }] }
    expect(removeOp(copy, D, { now: NOW }).baseT).toBe(90)
  })
})

describe('historyRows (Measurements.jsx recent list)', () => {
  const s = {
    measurementEnabled: ['neck', 'chest', 'waist', 'hips'],
    measurements: [
      { d: '2026-11-01', t: 1, waist: 81.28 },
      { d: '2026-11-08', t: 2, neck: 38.1, chest: 101.6, waist: 76.2, hips: 96.52, bodyFat: 15 },
    ],
  }
  test('newest first; the count includes every value; the preview is the first three enabled fields in inches', () => {
    const rows = historyRows(s, { now: NOW })
    expect(rows.map(r => r.d)).toEqual(['2026-11-08', '2026-11-01'])
    expect(rows[0].label).toBe('Nov 8')
    expect(rows[0].count).toBe(5)
    expect(rows[0].countLine).toBe('5 measurements')
    expect(rows[0].preview.map(p => [p.label, p.value, p.unit])).toEqual([['Neck', 15, 'in'], ['Chest', 40, 'in'], ['Waist', 30, 'in']])
    expect(rows[1].countLine).toBe('1 measurement')
  })
  test('two rows on a day are one history row', () => {
    const two = { measurements: [{ d: D, t: 1, waist: 81.28 }, { d: D, t: 2, neck: 38.1 }] }
    const rows = historyRows(two, { now: NOW })
    expect(rows).toHaveLength(1)
    expect(rows[0].count).toBe(2)
  })
  test('no list gives no rows', () => {
    expect(historyRows({}, { now: NOW })).toEqual([])
    expect(historyRows(undefined, { now: NOW })).toEqual([])
  })
})
