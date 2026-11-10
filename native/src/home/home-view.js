// The Home tab's model. Pure: `today` and `now` are passed in. `next` is the routine the Workout
// tab would start (next-up.js), `today` today's nutrition card as the Nutrition screen draws it
// (nutrition-screen.js todayView).
import { isNutritionNotice, todayView } from '../nutrition/nutrition-screen.js'
import { nextRoutineId } from '../workout/next-up.js'

export const HOME_EMPTY = { next: 'No routine to start yet. Add one in the Plan tab.' }

const NOTICE_LINK = { key: 'nutrition-notice', text: "A nutrition change wasn't sent. Open Nutrition to see it.", hint: 'Opens Nutrition.', href: '/nutrition' }

/**
 * The nutrition card's pointer to the Nutrition screen, which alone shows why an edit was not sent:
 * one line while any nutrition-day or setting notice is up (`notices` as listNotices gives them, so
 * dismissed ones are already gone), else null.
 */
export function nutritionNoticeLink(notices) {
  return Array.isArray(notices) && notices.some(isNutritionNotice) ? { ...NOTICE_LINK } : null
}

export const DAY_OPEN_FAILED = "Couldn't load today's nutrition. Try again."

/**
 * What Home's Log/Edit opens the day sheet on, from a fresh load (nutrition-source.js): that load's
 * { state, copy }, or { error } when it failed, and then no sheet opens. Never the source Home is
 * showing: Home is a tab and stays mounted, so until its focus reload lands that source can predate
 * a supplement tick saved on Nutrition, and a day built on it would save without the tick. The
 * sheet keeps this copy as its base, so a web change while it is open still supersedes.
 */
export function daySheetOpen(result) {
  const source = result?.ok ? result.source : null
  return source ? { source: { state: source.state, copy: source.copy } } : { error: DAY_OPEN_FAILED }
}

export function homeView(state, { today, now }) {
  const id = nextRoutineId(state ?? {}, now)
  const routine = id == null ? null : (Array.isArray(state?.routines) ? state.routines : []).find(r => r?.id === id)
  const name = typeof routine?.name === 'string' && routine.name ? routine.name : 'Workout'
  return { next: id == null ? null : { id, name }, today: todayView(state, { today }) }
}
