// The two rows under Your lifts on the Progress tab, each opening its screen. Pure; `today` and
// `now` come from the caller. Over the nutrition and measurement models.
import { fieldChoices, fieldView } from '../body/measurement-view.js'
import { amount, num, todayCard } from '../nutrition/nutrition-view.js'
import { dayLabel } from '../ui/dates.js'

const row = (title, line) => ({ title, line, a11y: `${title}, ${line}` })

// "2,500 of 2,600 kcal", or "2,500 kcal" with no target.
const against = (k, value, target, suffix = '') => (target != null ? `${num(value)} of ${amount(k, target)}${suffix}` : `${amount(k, value)}${suffix}`)

/** Today's calories and protein against the day type's targets, or "Not logged today". */
export function nutritionRow(state, { today }) {
  const c = todayCard(state, { today })
  if (!c.logged) return { title: 'Nutrition', line: 'Not logged today', a11y: 'Nutrition, not logged today' }
  return row('Nutrition', `${against('kcal', c.kcal, c.targets?.kcal)} · ${against('protein', c.protein, c.targets?.protein, ' protein')}`)
}

/**
 * The latest waist in inches with its day, or, with no waist logged, the first field the
 * Measurements screen offers that has a reading; else "No measurements yet".
 */
export function measurementsRow(state, { now }) {
  if (typeof now !== 'number' || !Number.isFinite(now)) throw new Error('measurementsRow: now (a finite ms timestamp) is required')
  const choices = fieldChoices(state)
  const order = [...choices.filter(f => f.key === 'waist'), ...choices.filter(f => f.key !== 'waist')]
  for (const f of order) {
    const v = fieldView(state, f.key, { now })
    if (v.latest) return row('Measurements', `${v.label} ${num(v.latest.value)} ${v.unit} · ${dayLabel(v.latest.d, now)}`)
  }
  return { title: 'Measurements', line: 'No measurements yet', a11y: 'Measurements, no measurements yet' }
}
