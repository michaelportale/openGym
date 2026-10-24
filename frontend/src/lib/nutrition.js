// The nutrition log: one entry per day with the day's totals, its type (training or rest), an
// optional note and the supplements ticked that day. No meals, no food database.
//
//   S.nutritionDays = { '2026-10-08': { kcal, protein, carbs, fat, fiber, dayType, note, supps, _ts }, … }
//   S.nutritionTargets = { training: { kcal, protein, fiber }, rest: { kcal, protein, fiber } }
//   S.supplements = [{ id, name }, …]
//
// Each day carries the time it was last written, so two devices that each logged a different day
// keep both and the same day keeps the later save (lib/sync-merge.js mergeStampedMap). Clearing a
// day writes a stamped entry without totals rather than deleting the key: a delete would come
// straight back from the other device's copy on the next sync. Targets and the supplement list are
// settings, merged whole by their edit stamp. All three start empty: nothing is prefilled.
//
// Body weight is not stored here. It is the weigh-in log (S.bodyweight), read week by week through
// lib/bodyweight.js, the same numbers the weigh-in sheet shows.
import { weeklyWeights } from './bodyweight.js'
import { isoOf, startOfWeek, todayISO } from './format.js'

export const DAY_TYPES = ['training', 'rest']
export const DAY_TYPE_LABEL = { training: 'Training day', rest: 'Rest day' }
/** The five totals of a day, all required to count it as logged. Grams except `kcal`. */
export const NUTRIENTS = ['kcal', 'protein', 'carbs', 'fat', 'fiber']
export const NUTRIENT_LABEL = { kcal: 'Calories', protein: 'Protein', carbs: 'Carbs', fat: 'Fat', fiber: 'Fiber' }
/** What a target can be set for, per day type. */
export const TARGET_KEYS = ['kcal', 'protein', 'fiber']
// Bounds that catch a typo (an extra zero), not a judgement on anyone's diet.
export const NUTRIENT_MAX = { kcal: 20000, protein: 2000, carbs: 2000, fat: 2000, fiber: 500 }
export const NOTE_MAX = 500
export const SUPPLEMENT_NAME_MAX = 60
export const SUPPLEMENTS_MAX = 50

const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v)
const ISO = /^\d{4}-\d{2}-\d{2}$/
const round = (key, n) => (key === 'kcal' ? Math.round(n) : Math.round(n * 10) / 10)

/** A number a field can hold: finite, 0 or more, within its bound, rounded; null otherwise. */
export function nutrientValue(key, v) {
  if (v == null || v === '') return null
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0 || n > (NUTRIENT_MAX[key] ?? Infinity)) return null
  return round(key, n)
}

/** A stored day read back with the junk left out, or null for none or a cleared one. */
export function readNutritionDay(entry) {
  if (!isMap(entry)) return null
  const out = {}
  for (const k of NUTRIENTS) out[k] = nutrientValue(k, entry[k])
  out.dayType = DAY_TYPES.includes(entry.dayType) ? entry.dayType : null
  out.note = typeof entry.note === 'string' ? entry.note.trim().slice(0, NOTE_MAX) : ''
  out.supps = Array.isArray(entry.supps) ? [...new Set(entry.supps.filter(x => typeof x === 'string'))] : []
  const any = NUTRIENTS.some(k => out[k] != null) || out.supps.length || out.note
  return any ? out : null
}

/** Whether a read-back day counts as logged: all five totals and a day type. */
export const isLoggedDay = day => !!day && NUTRIENTS.every(k => day[k] != null) && DAY_TYPES.includes(day.dayType)

/** The day logged on `iso`, read back, or null. */
export const nutritionDayOf = (S, iso) => readNutritionDay(isMap(S?.nutritionDays) ? S.nutritionDays[iso] : null)

/** Whether `iso` can be logged at all: a real date, today or earlier. */
export const canLogNutrition = (iso, today = todayISO()) => ISO.test(String(iso || '')) && iso <= today

/**
 * What is wrong with a form's values, as an English source string for t(), or null when they can
 * be saved. Every total is required and the day type must be chosen.
 */
export function nutritionInputError(values) {
  for (const k of NUTRIENTS) {
    const raw = values?.[k]
    if (raw == null || raw === '') return 'Fill in all five totals.'
    if (nutrientValue(k, raw) == null) return 'One of the totals is out of range.'
  }
  if (!DAY_TYPES.includes(values?.dayType)) return 'Choose training day or rest day.'
  return null
}

/**
 * S.nutritionDays with the totals, day type and note of `iso` set from `values`, stamped `now`.
 * The day's supplement ticks are kept. Throws on values nutritionInputError refuses.
 */
export function withNutritionDay(map, iso, values, now = Date.now()) {
  if (!ISO.test(String(iso || ''))) throw new Error('bad date')
  if (nutritionInputError(values)) throw new Error('bad values')
  const base = isMap(map) ? map : {}
  const prev = readNutritionDay(base[iso])
  const entry = { _ts: now, dayType: values.dayType }
  for (const k of NUTRIENTS) entry[k] = nutrientValue(k, values[k])
  const note = typeof values.note === 'string' ? values.note.trim().slice(0, NOTE_MAX) : ''
  if (note) entry.note = note
  if (prev?.supps.length) entry.supps = prev.supps
  return { ...base, [iso]: entry }
}

/** S.nutritionDays with the totals and note of `iso` taken away, the supplement ticks kept. */
export function clearNutritionDay(map, iso, now = Date.now()) {
  const base = isMap(map) ? map : {}
  const prev = readNutritionDay(base[iso])
  return { ...base, [iso]: prev?.supps.length ? { supps: prev.supps, _ts: now } : { _ts: now } }
}

/** S.nutritionDays with supplement `id` ticked (or not) on `iso`; the totals are kept as they are. */
export function withSupplementTick(map, iso, id, on, now = Date.now()) {
  if (!ISO.test(String(iso || ''))) throw new Error('bad date')
  const base = isMap(map) ? map : {}
  const cur = isMap(base[iso]) ? base[iso] : {}
  const set = new Set(Array.isArray(cur.supps) ? cur.supps : [])
  if (on) set.add(id); else set.delete(id)
  const { supps: _drop, ...rest } = cur
  return { ...base, [iso]: { ...rest, ...(set.size ? { supps: [...set] } : {}), _ts: now } }
}

/** The supplement list with junk dropped: [{ id, name }], names trimmed, each id once. */
export function readSupplements(list) {
  const seen = new Set()
  return (Array.isArray(list) ? list : []).filter(x => {
    if (!isMap(x) || typeof x.id !== 'string' || !x.id || seen.has(x.id)) return false
    if (typeof x.name !== 'string' || !x.name.trim()) return false
    seen.add(x.id); return true
  }).map(x => ({ id: x.id, name: x.name.trim().slice(0, SUPPLEMENT_NAME_MAX) }))
}

/**
 * The list with a supplement named `name` added under `id`, or null when the name is empty, is
 * already on the list (case-insensitive) or the list is full.
 */
export function withSupplement(list, name, id) {
  const clean = String(name || '').trim().slice(0, SUPPLEMENT_NAME_MAX)
  const cur = readSupplements(list)
  if (!clean || !id || cur.length >= SUPPLEMENTS_MAX) return null
  if (cur.some(x => x.name.toLowerCase() === clean.toLowerCase())) return null
  return [...cur, { id, name: clean }]
}

/** The list without supplement `id`. Past days keep their ticks; they just stop being shown. */
export const withoutSupplement = (list, id) => readSupplements(list).filter(x => x.id !== id)

/** Targets read back: { training: { kcal, protein, fiber }, rest: { … } }, null where unset. */
export function readTargets(targets) {
  const out = {}
  for (const type of DAY_TYPES) {
    out[type] = {}
    const src = isMap(targets) && isMap(targets[type]) ? targets[type] : {}
    for (const k of TARGET_KEYS) {
      const v = nutrientValue(k, src[k])
      out[type][k] = v && v > 0 ? v : null
    }
  }
  return out
}

/** Targets with `type`'s `key` set to `value` (null, '' or 0 clears it). */
export function withTarget(targets, type, key, value) {
  if (!DAY_TYPES.includes(type) || !TARGET_KEYS.includes(key)) throw new Error('bad target')
  const cur = readTargets(targets)
  const v = nutrientValue(key, value)
  cur[type][key] = v && v > 0 ? v : null
  return cur
}

/** Whether any target is set at all. */
export const hasTargets = targets => DAY_TYPES.some(type => TARGET_KEYS.some(k => readTargets(targets)[type][k] != null))

const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return isoOf(d) }
const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)

/** The seven iso dates of the week `iso` falls in, its first day being `ws` (weekStartOf). */
export const weekDays = (iso, ws) => { const first = isoOf(startOfWeek(iso, ws)); return Array.from({ length: 7 }, (_, i) => addDays(first, i)) }

/**
 * The week `iso` falls in, read back for the weekly view:
 *   - start, days (seven iso dates), logged (how many have all five totals and a day type)
 *   - weight: { avg, n, delta } from the weigh-in log; delta against the week right before,
 *     null when that week has no weigh-in. null when this week has none.
 *   - avg: { kcal, protein, fiber } over the logged days, null with none logged
 *   - target: { kcal, protein, fiber }, each the mean target of the logged days whose type has
 *     that target set; null when none of them has one
 *   - protein: { hit, of }, logged days at or over their protein target, out of logged days that
 *     have a protein target
 */
export function weekSummary(S, iso, ws) {
  const days = weekDays(iso, ws)
  const targets = readTargets(S?.nutritionTargets)
  const logged = days.map(d => nutritionDayOf(S, d)).filter(isLoggedDay)
  const avg = {}, target = {}
  for (const k of TARGET_KEYS) {
    const a = mean(logged.map(x => x[k]))
    avg[k] = a == null ? null : round(k, a)
    const tg = mean(logged.map(x => targets[x.dayType][k]).filter(v => v != null))
    target[k] = tg == null ? null : round(k, tg)
  }
  const withProtein = logged.filter(x => targets[x.dayType].protein != null)
  const protein = { hit: withProtein.filter(x => x.protein >= targets[x.dayType].protein).length, of: withProtein.length }
  const weeks = weeklyWeights(S?.bodyweight, ws)
  const cur = weeks.find(w => w.key === days[0])
  const prev = weeks.find(w => w.key === addDays(days[0], -7))
  const weight = cur ? { avg: Math.round(cur.avg * 100) / 100, n: cur.n, delta: prev ? Math.round((cur.avg - prev.avg) * 100) / 100 : null } : null
  return { start: days[0], days, logged: logged.length, avg: logged.length ? avg : null, target, protein, weight }
}

/** Days with a log of any kind (totals, a note or a tick), newest first: the screen's history. */
export function nutritionHistory(S) {
  const map = isMap(S?.nutritionDays) ? S.nutritionDays : {}
  return Object.keys(map).filter(d => ISO.test(d) && readNutritionDay(map[d])).sort().reverse()
}
