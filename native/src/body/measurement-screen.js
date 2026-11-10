// The Measurements screen's view models and what its saves write. Pure: the screen and its log
// sheet render what these return, and every save puts what measurementSaveArgs builds. They sit
// over the Task 5 models (measurement-view.js); the wording is the web's Measurements.jsx, in
// English, with lengths in inches.
import { readCopy } from '../sync/server-copy.js'
import { dayLabel } from '../ui/dates.js'
import { numberText, parseNumberText } from '../ui/number-text.js'
import { historyRows, logForm, removeOp } from './measurement-view.js'

// The web's fmtNum in English: one decimal at most, thousands separators (format.js:58).
const num = n => (Math.round(n * 10) / 10).toLocaleString('en-US', { maximumFractionDigits: 1 })
const valueText = (value, unit) => `${num(value)} ${unit}`

/** The field the screen shows: the one chosen while it is offered, else waist, else the first (Measurements.jsx). */
export function pickField(choices, selected) {
  const has = key => choices.some(f => f.key === key)
  if (selected != null && has(selected)) return selected
  return has('waist') ? 'waist' : choices[0]?.key ?? null
}

/** The card's head for a fieldView (or null: no field): its name, the latest value, the change since the one before. */
export function latestView(view) {
  if (!view) return { label: 'Body measurements', value: '–', change: null }
  const { change } = view
  return {
    label: view.label,
    value: view.latest ? valueText(view.latest.value, view.unit) : '–',
    change: change != null && change !== 0 ? `${change > 0 ? '+' : ''}${valueText(change, view.unit)} since previous` : null,
  }
}

/** What VoiceOver says for the chart: one sentence with the field, the range and the latest reading. */
export function measurementChartLabel(view, range, { now }) {
  const span = range === 0 ? 'all time' : `last ${range} days`
  const latest = view?.latest ? `: latest ${valueText(view.latest.value, view.unit)} on ${dayLabel(view.latest.d, now)}` : ''
  return `${view?.label ?? 'Body measurements'}, ${span}${latest}`
}

/** The history (measurement-view.js historyRows) with each day's preview as one line and its Edit and Delete labels. */
export function historyList(state, { now }) {
  return historyRows(state, { now }).map(r => ({
    ...r,
    previewLine: r.preview.map(p => `${p.label} ${valueText(p.value, p.unit)}`).join(' · '),
    editLabel: `Edit ${r.label}`,
    deleteLabel: `Delete ${r.label}`,
  }))
}

/**
 * The log sheet's draft for day `d`. Edit (`edit` true) shows the day's values as text, its
 * populated disabled fields too (logForm). Log starts empty on the enabled fields whatever the day
 * holds, as the web's Log has no source day: a save onto a day that has an entry is then refused.
 * `opened` is the values as shown, what logValues tells a touched field from.
 */
export function logDraft(state, d, { edit }) {
  const f = edit ? logForm(state, d) : logForm({ ...(state && typeof state === 'object' ? state : {}), measurements: [] }, d)
  const text = {}
  for (const field of f.fields) text[field.key] = numberText(f.values[field.key])
  return { d, editing: f.editing, title: f.editing ? 'Edit measurements' : 'Log measurements', fields: f.fields, opened: f.values, text }
}

/**
 * The values applyLogForm is given: a field typed to something other than it showed is the typed
 * number (null when cleared); a field left as it was is `latest`, the value the day shows now, so
 * applyLogForm leaves its stored cm as it is, a sync's change since the sheet opened included.
 */
export function logValues({ opened, text, latest }) {
  const out = {}
  for (const key of Object.keys(text ?? {})) {
    const typed = parseNumberText(text[key])
    out[key] = typed === (opened?.[key] ?? null) ? latest?.[key] ?? null : typed
  }
  return out
}

/**
 * What a measurement save puts in the store (measurement-store.js put). A set is the entry
 * applyLogForm built, under its own d and t. A remove is removeOp on the server copy (the bundled
 * snapshot when no copy is held), never on the overlaid state: its baseT is the copy's own entry t,
 * and the store adds the t's this phone set itself (ownTs).
 */
export function measurementSaveArgs({ copy, bundled }, edit, { now }) {
  if (edit?.op === 'set') return { d: edit.entry.d, op: 'set', entry: edit.entry, t: edit.entry.t }
  if (edit?.op === 'remove') return removeOp(copy ? copy.state : bundled?.state, edit.d, { now })
  throw new Error(`measurementSaveArgs: not a set or remove: ${edit?.op}`)
}

/**
 * A measurement save, from the stores: `measurements` (measurement-store.js), `serverCopy` and the
 * bundled snapshot. A remove reads the stored copy right before its put, so its base is the copy as
 * it is then, a sync that landed since Delete was tapped included; a copy that cannot be read counts
 * as none (the snapshot's). A set reads no copy. Resolves with the store's answer; a failed write
 * rejects.
 */
export async function putMeasurement({ measurements, serverCopy, bundled }, edit, { now }) {
  const copy = edit?.op === 'remove' ? await readCopy(serverCopy) : null
  return measurements.put(measurementSaveArgs({ copy, bundled }, edit, { now }))
}
