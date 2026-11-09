// The Nutrition screen's models: pure, no React, no clock. They sit over the web's own
// lib/nutrition.js (through shared/training.js), which owns the limits, the error strings and the
// supplement rules. Where a rule lives only in the web's Nutrition.jsx it is restated here with a
// test naming the line.
//
// The phone never mints a nutrition stamp. Every day value returned here carries no `_ts` of its
// own: the sync writes the stored copy's `_ts` back on push and the server stamps. A stored `_ts`
// and any key this app doesn't know ride along untouched. Settings (`nutritionTargets`,
// `supplements`) are whole keys: the setting models return the whole new value, or `{ error }`.
import { nutrition } from '../shared/training.js'

const {
  NUTRIENTS, DAY_TYPES, TARGET_KEYS, canLogNutrition, isLoggedDay, nutritionDayOf, nutritionHistory,
  nutritionInputError, readSupplements, readTargets, weekSummary, withNutritionDay, withSupplement,
  withSupplementTick, withTarget, withoutSupplement, clearNutritionDay,
} = nutrition

export const ERR_BAD_DATE = 'Choose a valid date' // Nutrition.jsx:51
export const ERR_DUPLICATE = 'That supplement is already on the list.' // Nutrition.jsx:105

export const NAME = { kcal: 'Calories', protein: 'Protein', carbs: 'Carbs', fat: 'Fat', fiber: 'Fiber' }
export const DAY_TYPE_NAME = { training: 'Training day', rest: 'Rest day' } // Nutrition.jsx:23
const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v)
const rawDay = (state, iso) => (isMap(state?.nutritionDays) && isMap(state.nutritionDays[iso]) ? state.nutritionDays[iso] : null)
const KNOWN = new Set([...NUTRIENTS, 'dayType', 'note', 'supps', '_ts'])

// The web's fmtNum in English: one decimal at most, thousands separators (format.js:58).
export const num = n => (Math.round(n * 10) / 10).toLocaleString('en-US', { maximumFractionDigits: 1 })
export const amount = (k, v) => `${num(v)} ${k === 'kcal' ? 'kcal' : 'g'}` // Nutrition.jsx:22,29
const line = (k, v) => `${NAME[k]} ${amount(k, v)}`

// The keys of the stored day this app doesn't own, plus its stored stamp. Never a new stamp.
function carried(raw) {
  const out = {}
  if (raw) for (const k of Object.keys(raw)) if (!KNOWN.has(k)) out[k] = raw[k]
  return out
}
const withStoredStamp = (value, raw) => {
  if (raw && '_ts' in raw) value._ts = raw._ts
  return value
}

/** The Today card: totals only when the day counts as logged, targets for its day type. */
export function todayCard(state, { today }) {
  const day = nutritionDayOf(state, today)
  const logged = isLoggedDay(day)
  const card = { logged, kcal: null, protein: null, carbs: null, fat: null, fiber: null, dayType: null, targets: null, lines: [] }
  if (!logged) return card
  for (const k of NUTRIENTS) card[k] = day[k]
  card.dayType = day.dayType
  const t = readTargets(state?.nutritionTargets)[day.dayType]
  card.targets = TARGET_KEYS.some(k => t[k] != null) ? { ...t } : null
  card.lines = NUTRIENTS.filter(k => k !== 'kcal').map(k => line(k, day[k])) // Nutrition.jsx:240
  return card
}

/** The week card, from the web's weekSummary. `anchor` is any day of the week (default today). */
export function weekView(state, { today, weekStart, anchor }) {
  const ws = (weekStart ?? state?.weekStart) === 0 ? 0 : 1 // format.js:116
  return weekSummary(state, anchor || today, ws)
}

/** The Recent days list, newest first, as the web's DayRow reads each one. */
export function recentDays(state, { limit = 14 } = {}) {
  const supplements = readSupplements(state?.supplements)
  return nutritionHistory(state).slice(0, limit).map(iso => {
    const day = nutritionDayOf(state, iso)
    const logged = isLoggedDay(day)
    const ticked = day.supps.filter(id => supplements.some(x => x.id === id)).length
    const subtitle = (logged ? DAY_TYPE_NAME[day.dayType] : 'No totals logged')
      + (supplements.length > 0 ? ` · Supplements ${ticked}/${supplements.length}` : '')
    return {
      iso, logged, dayType: logged ? day.dayType : null, subtitle, ticked, suppTotal: supplements.length,
      lines: logged ? NUTRIENTS.map(k => line(k, day[k])) : [], note: day.note, canClear: logged,
    }
  })
}

// Whether a workout is logged on `iso`: from the caller's index when given, else the state's list.
function hasWorkout(state, iso, workoutsByDay) {
  if (workoutsByDay instanceof Set) return workoutsByDay.has(iso)
  if (Array.isArray(workoutsByDay)) return workoutsByDay.includes(iso)
  if (isMap(workoutsByDay)) return !!workoutsByDay[iso]
  return (Array.isArray(state?.workouts) ? state.workouts : []).some(w => w?.d === iso) // Nutrition.jsx:32
}

/** The day sheet's draft: the saved values, or empty with the guessed day type. */
export function dayForm(state, iso, { workoutsByDay } = {}) {
  const day = nutritionDayOf(state, iso)
  const out = { dayType: day?.dayType || (hasWorkout(state, iso, workoutsByDay) ? 'training' : 'rest'), note: day?.note || '' }
  for (const k of NUTRIENTS) out[k] = day?.[k] ?? null // Nutrition.jsx:36-37
  out.existing = isLoggedDay(day) // Nutrition.jsx:46: "Edit day" vs "Log a day"
  return out
}

/** The day value to save for `iso`, or `{ error }` (web copy). Future days are refused. */
export function applyDayForm(state, iso, form, { today }) {
  if (!canLogNutrition(iso, today)) return { error: ERR_BAD_DATE } // Nutrition.jsx:51
  const err = nutritionInputError(form) // Nutrition.jsx:52
  if (err) return { error: err }
  const raw = rawDay(state, iso)
  const made = withNutritionDay({ [iso]: raw }, iso, form, 0)[iso]
  const { _ts: _drop, ...web } = made
  return { value: withStoredStamp({ ...carried(raw), ...web }, raw) }
}

/** The day value after Clear: the totals and note gone, the ticks kept. Never a delete. */
export function clearDayValue(state, iso) {
  const raw = rawDay(state, iso)
  const { _ts: _drop, ...web } = clearNutritionDay({ [iso]: raw }, iso, 0)[iso]
  return withStoredStamp({ ...carried(raw), ...web }, raw)
}

/** The day value with supplement `suppId` flipped (ticked <-> unticked). Throws as the web does on a bad date or id. */
export function toggleSupplement(state, iso, suppId) {
  const raw = rawDay(state, iso)
  const on = !nutritionDayOf(state, iso)?.supps.includes(suppId)
  const { _ts: _drop, ...web } = withSupplementTick({ [iso]: raw }, iso, suppId, on, 0)[iso]
  return withStoredStamp(web, raw)
}

/** The targets sheet's fields: { training: { kcal, protein, fiber }, rest: { … } }, null where unset. */
export const targetsForm = state => readTargets(state?.nutritionTargets)

/** The whole new `nutritionTargets` with one field set (empty or 0 clears), or `{ error }`. */
export function applyTargets(state, type, key, value) {
  try { return withTarget(state?.nutritionTargets, type, key, value) } catch { return { error: 'bad target' } }
}

/** The whole new `supplements` list with `name` added under `id`, or `{ error }` (empty: `{ error: '' }`, show nothing). */
export function addSupplement(state, name, id) {
  if (!String(name || '').trim() || !id) return { error: '' } // Nutrition.jsx:105: only a non-empty name toasts
  return withSupplement(state?.supplements, name, id) || { error: ERR_DUPLICATE } // also the full list, as the web
}

/** The whole new list without `id`. No day is touched: past ticks stay. */
export const removeSupplement = (state, id) => withoutSupplement(state?.supplements, id)
