// The Home tab's model. Pure: `today` and `now` are passed in. `next` is the routine the Workout
// tab would start (next-up.js), `nutrition` today's card (nutrition-view.js todayCard); the screen
// renders the card through todayView, as the Nutrition screen does.
import { todayCard } from '../nutrition/nutrition-view.js'
import { nextRoutineId } from '../workout/next-up.js'

export const HOME_EMPTY = { next: 'No routine to start yet. Add one in the Plan tab.' }

export function homeView(state, { today, now }) {
  const id = nextRoutineId(state ?? {}, now)
  const routine = id == null ? null : (Array.isArray(state?.routines) ? state.routines : []).find(r => r?.id === id)
  const name = typeof routine?.name === 'string' && routine.name ? routine.name : 'Workout'
  return { next: id == null ? null : { id, name }, nutrition: todayCard(state, { today }) }
}
