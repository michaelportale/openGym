// The Home tab's model. Pure: `today` and `now` are passed in. `next` is the routine the Workout
// tab would start (next-up.js), `nutrition` today's card (nutrition-view.js todayCard); the screen
// renders the card through todayView, as the Nutrition screen does.
import { isNutritionNotice } from '../nutrition/nutrition-screen.js'
import { todayCard } from '../nutrition/nutrition-view.js'
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

export function homeView(state, { today, now }) {
  const id = nextRoutineId(state ?? {}, now)
  const routine = id == null ? null : (Array.isArray(state?.routines) ? state.routines : []).find(r => r?.id === id)
  const name = typeof routine?.name === 'string' && routine.name ? routine.name : 'Workout'
  return { next: id == null ? null : { id, name }, nutrition: todayCard(state, { today }) }
}
