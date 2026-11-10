// The Nutrition screen's view models and what its saves write. Pure: the screen and its sheets
// render what these return, and every save puts what nutritionSaveArgs builds. They sit over the
// Task 4 models (nutrition-view.js) and the web's lib/nutrition.js; the wording and layout are the
// web's Nutrition.jsx and NutritionWeek.jsx, in English.
import { nutrition } from '../shared/training.js'
import { addDays, dayLabel, shortDate } from '../ui/dates.js'
import { numberText, parseNumberText } from '../ui/number-text.js'
import { DAY_TYPE_NAME, NAME, amount, applyTargets, dayForm, num, recentDays, targetsForm, todayCard, weekView } from './nutrition-view.js'

const { NUTRIENTS, TARGET_KEYS, DAY_TYPES, nutritionDayOf, readSupplements } = nutrition

const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v)
const own = (map, key) => (isMap(map) && Object.hasOwn(map, key) ? map[key] : undefined)
const MACROS = NUTRIENTS.filter(k => k !== 'kcal')

/**
 * Whether a tap that writes a day (a tick, Clear) or opens the day sheet may run: only on a loaded
 * screen with no save running. A sheet opened while a tick is saving would take the state before
 * the tick, and its Save would replace the pending day without it.
 */
export const canAct = ({ ready, busy }) => !!ready && !busy

/** The Today card (Nutrition.jsx:228-243), with each total against its day type's target. */
export function todayView(state, { today }) {
  const c = todayCard(state, { today })
  if (!c.logged) return { logged: false, label: 'Today', headline: null, empty: 'Nothing logged today yet.', target: null, lines: [], action: 'Log' }
  const of = k => (c.targets?.[k] != null ? ` of ${amount(k, c.targets[k])}` : '')
  return {
    logged: true,
    label: `Today · ${DAY_TYPE_NAME[c.dayType]}`,
    headline: amount('kcal', c.kcal),
    empty: null,
    target: c.targets?.kcal != null ? `Target ${amount('kcal', c.targets.kcal)}` : null,
    lines: MACROS.map(k => `${NAME[k]} ${amount(k, c[k])}${of(k)}`),
    action: 'Edit',
  }
}

/** Today's supplement check-offs (Nutrition.jsx:250-253): each listed supplement, ticked or not. */
export function supplementChecks(state, { today }) {
  const ticks = new Set(nutritionDayOf(state, today)?.supps ?? [])
  return readSupplements(state?.supplements).map(x => ({ id: x.id, name: x.name, checked: ticks.has(x.id) }))
}

/** The sheet's Supplements section: each listed one with its Remove label, and the footer. */
export function supplementsSection(state) {
  const rows = readSupplements(state?.supplements).map(x => ({ id: x.id, name: x.name, removeLabel: `Remove ${x.name}` }))
  return { rows, footer: rows.length ? 'Removing one keeps the days it was ticked.' : 'Add the supplements you take, then tick them off each day.' }
}

const TILE_LABEL = { kcal: 'Average calories', protein: 'Average protein', fiber: 'Average fiber' }
// Plus, the true minus (U+2212) or nothing, then the size (NutritionWeek.jsx:52).
const signed = v => `${v > 0 ? '+' : v < 0 ? '−' : ''}${num(Math.abs(v))}`
const vsTarget = (k, avg, target) => (avg == null ? null : target == null ? 'No target set' : `Target ${amount(k, target)}`)
const tile = (key, label, value, sub = null) => ({ key, label, value, sub, a11y: `${label}: ${value}${sub ? `, ${sub}` : ''}` })

/**
 * The week card (NutritionWeek.jsx). `anchor` is a day of the week shown, null for this week;
 * `bodyweight` the weigh-in list to average (this phone's pending weigh-ins laid over). `prev` is
 * the anchor a step back; `next` the anchor a step forward (null: this week), offered only when
 * the week shown is not this one.
 */
export function weekCard(state, { today, anchor = null, bodyweight }) {
  const s = { ...(isMap(state) ? state : {}), bodyweight }
  const thisWeek = weekView(s, { today }).start
  const w = weekView(s, { today, anchor: anchor || today })
  const current = w.start === thisWeek
  const after = addDays(w.start, 7)
  const empty = !w.logged && !w.weight
  const tiles = empty ? [] : [
    tile('weight', 'Average weight', w.weight ? `${num(w.weight.avg)} lb` : '–',
      !w.weight ? 'No weigh-ins this week' : w.weight.delta == null ? 'No weigh-in last week to compare' : `${signed(w.weight.delta)} lb vs last week`),
    tile('logged', 'Days logged', `${w.logged}/7`),
    ...TARGET_KEYS.map(k => tile(k, TILE_LABEL[k], w.avg ? amount(k, w.avg[k]) : '–', vsTarget(k, w.avg?.[k], w.target[k]))),
    tile('protein-hit', 'Protein target reached', w.protein.of ? `${w.protein.hit}/${w.protein.of}` : '–', w.protein.of ? null : 'Set a protein target to count this'),
  ]
  return {
    title: current ? 'This week' : `Week of ${shortDate(w.start, { year: w.start.slice(0, 4) !== String(today).slice(0, 4) })}`,
    current,
    empty,
    emptyText: "Your week's averages show here once you log a day.",
    tiles,
    prev: addDays(w.start, -7),
    next: current || after >= thisWeek ? null : after,
  }
}

/** Recent days (Nutrition.jsx DayRow), newest first, with the date and the Edit and Clear labels. */
export function dayRows(state, { now }) {
  return recentDays(state).map(r => {
    const label = dayLabel(r.iso, now)
    return { ...r, label, editLabel: `Edit ${label}`, clearLabel: `Clear ${label}` }
  })
}

/** The day sheet's draft for `iso` (Nutrition.jsx formFor): its title, day type, note and the totals as text. */
export function dayDraft(state, iso) {
  const f = dayForm(state, iso)
  const text = {}
  for (const k of NUTRIENTS) text[k] = numberText(f[k])
  return { iso, existing: f.existing, title: f.existing ? 'Edit day' : 'Log a day', dayType: f.dayType, note: f.note, text }
}

/** The draft back to the form applyDayForm reads: calories whole, grams to the decimal, empty null. */
export function dayValues(draft) {
  const out = { dayType: draft?.dayType, note: draft?.note }
  for (const k of NUTRIENTS) out[k] = parseNumberText(draft?.text?.[k], { decimal: k !== 'kcal' })
  return out
}

/** The day sheet's date a step of n days on, or null past today (the web's max today) or for a bad date. */
export function stepDay(iso, n, today) {
  const next = addDays(iso, n)
  return next && next <= today ? next : null
}

/** The targets fields as text: { training: { kcal, protein, fiber }, rest: { … } }, empty where unset. */
export function targetsDraft(state) {
  const t = targetsForm(state)
  const out = {}
  for (const type of DAY_TYPES) {
    out[type] = {}
    for (const k of TARGET_KEYS) out[type][k] = numberText(t[type][k])
  }
  return out
}

/**
 * The whole new `nutritionTargets` the draft makes, every field through the web's withTarget (empty,
 * 0 or out of range clears), or null when it is what is stored: nothing to write.
 */
export function targetsSave(state, draft) {
  const stored = targetsForm(state)
  let value = stored
  for (const type of DAY_TYPES) {
    for (const k of TARGET_KEYS) value = applyTargets({ nutritionTargets: value }, type, k, parseNumberText(draft?.[type]?.[k], { decimal: k !== 'kcal' }))
  }
  return JSON.stringify(value) === JSON.stringify(stored) ? null : value
}

const SETTING = { nutritionTargets: 'your nutrition targets', supplements: 'your supplements' }
const byAt = (a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)

/** Whether a notice (pending-edits.js listNotices) is one the Nutrition screen shows: a day's or a nutrition setting's. */
export const isNutritionNotice = n => n?.kind === 'nutritionDay' || (n?.kind === 'setting' && Object.hasOwn(SETTING, n.key))

/** The nutrition-day and setting notices (pending-edits.js listNotices), oldest first, in the exact texts. */
export function nutritionNotices(notices, { now }) {
  return (Array.isArray(notices) ? notices : [])
    .filter(isNutritionNotice)
    .sort(byAt)
    .map(n => {
      const what = n.kind === 'nutritionDay' ? `${dayLabel(n.key, now)} nutrition` : SETTING[n.key]
      return {
        id: `${n.kind}:${n.key}`,
        kind: n.kind,
        key: n.key,
        text: `Your change to ${what} wasn't sent: it was changed on the web first. This shows the web's version.`,
        dismissLabel: `Dismiss notice about ${what}`,
      }
    })
}

/**
 * What a nutrition save puts in the pending-edit store (pending-edits.js put). The base is the stamp
 * the push's guard will read (edit-guard.js), from the server copy the edit was made on, or the
 * bundled snapshot when no copy is held, never from the screen's overlaid state: a day's `_ts`, a
 * setting's `edited[key]`, null when there is none. With no copy the edit is `fresh` (plan-view.js
 * editBase): made on the snapshot, it must not keep a base or sent value from an earlier paired row.
 */
export function nutritionSaveArgs({ copy, bundled }, { kind, key, value }, { t }) {
  const base = copy ? copy.state : bundled?.state
  let baseTs
  if (kind === 'nutritionDay') {
    const day = own(base?.nutritionDays, key)
    baseTs = (isMap(day) ? day._ts : null) ?? null
  } else if (kind === 'setting') {
    baseTs = own(base?.edited, key) ?? null
  } else {
    throw new Error(`nutritionSaveArgs: not a nutrition kind: ${kind}`)
  }
  return { kind, key, baseTs, value, t, fresh: !copy }
}
