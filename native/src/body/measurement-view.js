// Pure models for the Measurements screen and the Home card. Values are stored in cm and shown in
// inches (body fat is a percent and is never converted). The web's rules come from the shared
// measurements.js; the logging rules that live only in views/Measurements.jsx are restated here.
// No I/O, no React, no clock: `now` is always passed in.
import { measurements as M } from '../shared/training.js'
import { dayLabel } from '../ui/dates.js'

const UNIT = 'lb' // pounds only: measurements show in inches
const DAY = /^\d{4}-\d{2}-\d{2}$/
const KEYS = M.MEASUREMENT_KEYS
const round1 = n => Math.round(n * 10) / 10
const positive = v => v != null && Number.isFinite(+v) && +v > 0
const isObj = v => !!v && typeof v === 'object'

// Time comes only from the caller: a missing or non-finite now is a programming error.
const needNow = (fn, now) => {
  if (typeof now !== 'number' || !Number.isFinite(now)) throw new Error(`${fn}: now (a finite ms timestamp) is required`)
}

const unitOf = key => (key === 'bodyFat' ? '%' : M.measurementUnit(UNIT))

// A display-only copy of the state's measurement fields, the web's normalised and folded view.
// Never the source of a saved entry: it drops keys it does not know.
function displayState(state) {
  const s = isObj(state) ? state : {}
  const copy = {
    unit: UNIT,
    measurements: Array.isArray(s.measurements) ? s.measurements.filter(isObj).map(e => ({ ...e })) : [],
    customMeasurements: Array.isArray(s.customMeasurements) ? s.customMeasurements : [],
    measurementEnabled: Array.isArray(s.measurementEnabled) ? s.measurementEnabled : undefined,
  }
  if (copy.measurementEnabled === undefined) delete copy.measurementEnabled
  return M.normalizeMeasurementsState(copy)
}

// The raw stored rows of one day, oldest first (by t, the web's order), folded the web's way
// (measurements.js mergeMeasurementEntries): the later row wins per field, a field it leaves empty
// keeps the earlier value. Unlike the web's display fold, every key of every row survives, and a
// value is kept exactly as stored. Returns null when the day has no row.
function rawDay(state, d) {
  const list = Array.isArray(state?.measurements) ? state.measurements : []
  const rows = list.filter(e => isObj(e) && e.d === d)
    .map((e, i) => ({ e, i }))
    .sort((a, b) => (Number(a.e.t) || 0) - (Number(b.e.t) || 0) || a.i - b.i)
    .map(x => x.e)
  if (rows.length === 0) return null
  return rows.reduce((a, b) => {
    const out = { ...a, ...b }
    for (const key of KEYS) out[key] = positive(b[key]) ? b[key] : positive(a[key]) ? a[key] : b[key] ?? a[key] ?? null
    const other = new Map((Array.isArray(a.other) ? a.other : []).filter(o => isObj(o) && o.id).map(o => [o.id, o]))
    for (const o of Array.isArray(b.other) ? b.other : []) {
      if (!isObj(o) || !o.id) continue
      const prev = other.get(o.id)
      other.set(o.id, prev && !positive(o.value) && positive(prev.value) ? { ...o, value: prev.value } : o)
    }
    out.other = [...other.values()]
    return out
  })
}

// The field picker: the enabled fields, plus (as the web screen does) any field that has a logged
// value but is not enabled, so its history stays reachable.
export function fieldChoices(state) {
  const s = displayState(state)
  const out = M.enabledMeasurementFields(s).map(f => ({ ...f, unit: unitOf(f.key) }))
  const has = key => out.some(f => f.key === key)
  for (const f of M.MEASUREMENT_FIELDS) {
    if (M.latestMeasurement(s, f.key) && !has(f.key)) out.push({ ...f, unit: unitOf(f.key) })
  }
  for (const c of s.customMeasurements) {
    const key = 'other:' + c.id
    if (M.latestMeasurement(s, key) && !has(key)) out.push({ key, label: c.name, custom: true, group: 'Other', unit: unitOf(key) })
  }
  return out
}

// One field's card: the latest value and day, the change since the previous reading, the series
// for LineChart (points [{ t, d, y }] in inches or percent) over `range` days (0 = all).
export function fieldView(state, key, { range = 0, now } = {}) {
  needNow('fieldView', now)
  const s = displayState(state)
  const label = M.measurementLabel(key, s.customMeasurements)
  const unit = unitOf(key)
  const all = M.measurementSeries(s, key, 0, now)
  const series = range ? M.measurementSeries(s, key, range, now) : all
  const last = all.at(-1)
  const prev = all.at(-2)
  return {
    key, label, unit,
    latest: last ? { value: last.y, d: last.d } : null,
    change: last && prev ? round1(last.y - prev.y) : null,
    series,
  }
}

function shownValue(entry, key) {
  const v = M.measurementValue(entry, key)
  return v == null ? null : key === 'bodyFat' ? v : M.toMeasurementDisplay(v, UNIT)
}

// The logging draft for one day: { d, editing, fields: [{ key, label, group, unit, custom? }],
// values: { [key]: inches | percent | null } }. A field with a stored value is listed even if
// disabled (an edit must expose it, as the web's sheet does).
export function logForm(state, d) {
  const s = displayState(state)
  const entry = s.measurements.find(e => e.d === d) || null
  const fields = M.enabledMeasurementFields(s).map(f => ({ ...f }))
  if (entry) {
    for (const f of M.MEASUREMENT_FIELDS) {
      if (entry[f.key] != null && !fields.some(x => x.key === f.key)) fields.push({ ...f })
    }
    for (const o of entry.other || []) {
      if (o.value != null && !fields.some(x => x.key === 'other:' + o.id)) {
        fields.push({ key: 'other:' + o.id, label: o.name, custom: true, group: 'Other' })
      }
    }
  }
  const values = {}
  for (const f of fields) {
    f.unit = unitOf(f.key)
    values[f.key] = entry ? shownValue(entry, f.key) : null
  }
  return { d, editing: Boolean(entry), fields, values }
}

const localToday = now => {
  const t = new Date(now)
  const p = n => String(n).padStart(2, '0')
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`
}

// The form's number for a field: 0.1-rounded, or null when empty, zero or not a number.
const typed = v => (v == null || v === '' || !(Number(v) > 0) || !Number.isFinite(Number(v)) ? null : round1(Number(v)))

// The entry a save writes, built on the raw stored rows of the day: every key survives and only the
// fields whose value differs from what logForm showed are converted and written. form:
// { values: { [key]: number | null }, editing }. A new day (editing false) that already holds an
// entry is refused. t is the weigh-in saveOp floor (weigh-in-view.js): above now, the shown entry
// and the day's deletion stamp. Returns { entry, error }.
export function applyLogForm(state, d, form, { now } = {}) {
  needNow('applyLogForm', now)
  const fail = error => ({ entry: null, error })
  if (!DAY.test(d || '') || d > localToday(now)) return fail('Choose a valid date')
  const s = displayState(state)
  const shown = s.measurements.find(e => e.d === d) || null
  if (!form?.editing && shown) return fail('That date already has measurements. Edit it instead.')

  const raw = rawDay(state, d)
  const custom = s.customMeasurements
  const entry = raw ? { ...raw } : M.emptyMeasurement(d, custom)
  entry.other = (Array.isArray(entry.other) ? entry.other : []).map(o => ({ ...o }))
  const values = isObj(form?.values) ? form.values : {}
  const before = logForm(state, d).values

  // Measurements.jsx:59: body fat over 100 stops the save (the read path nulls it, measurements.js:50).
  if (typed(values.bodyFat) > 100) return fail('Body fat must be between 0 and 100%.')

  for (const [key, given] of Object.entries(values)) {
    const isCustom = key.startsWith('other:')
    if (!isCustom && !KEYS.includes(key)) continue
    const value = typed(given)
    if (value === (before[key] ?? null)) continue // untouched: its stored cm stays as it is
    const stored = value == null ? null : key === 'bodyFat' ? (value) : M.fromMeasurementDisplay(value, UNIT)
    if (isCustom) {
      const id = key.slice(6)
      const item = entry.other.find(o => o.id === id)
      if (item) item.value = stored
      else entry.other.push({ id, name: custom.find(c => c.id === id)?.name || 'Other', value: stored })
    } else entry[key] = stored
  }

  if (!M.measurementEntryHasValues(entry)) return fail('Enter at least one measurement')
  const floors = [now, shown ? Number(shown.t) + 1 : NaN, Number(state?.deleted?.measurements?.[d]) > 0 ? Number(state.deleted.measurements[d]) + 1 : NaN]
  entry.d = d
  entry.t = Math.max(...floors.filter(Number.isFinite))
  return { entry, error: null }
}

// The op that removes a day. baseT is the t of the stored copy's own entry for the day (the copy
// without this phone's pending overlay): the larger t of its rows, which is the row the guard reads.
export function removeOp(copyState, d, { now } = {}) {
  needNow('removeOp', now)
  const ts = (Array.isArray(copyState?.measurements) ? copyState.measurements : [])
    .filter(e => isObj(e) && e.d === d && Number.isFinite(Number(e.t))).map(e => Number(e.t))
  return { d, op: 'remove', t: now, baseT: ts.length ? Math.max(...ts) : null }
}

// The history list, newest day first: { d, label, count, preview: [{ key, label, value, unit }] }
// with the first three enabled fields that hold a value, as the web screen shows them.
export function historyRows(state, { now } = {}) {
  needNow('historyRows', now)
  const s = displayState(state)
  const fields = M.enabledMeasurementFields(s)
  return [...s.measurements].reverse().map(entry => {
    const count = KEYS.filter(k => entry[k] != null).length + (entry.other || []).filter(o => o.value != null).length
    const preview = fields.map(f => ({ key: f.key, label: f.label, value: shownValue(entry, f.key), unit: unitOf(f.key) }))
      .filter(p => p.value != null).slice(0, 3)
    return { d: entry.d, label: dayLabel(entry.d, now), count, countLine: `${count} measurement${count === 1 ? '' : 's'}`, preview }
  })
}
