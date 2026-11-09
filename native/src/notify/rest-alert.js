import { projectRest } from '../session/timing.js'
import { currentExerciseIndex, workoutScreen } from '../workout/workout-view.js'

// Rest alerts follow the journal, the only truth. The notification center is a cache of it: these
// helpers compare "the alert the journal implies" with what is scheduled and say what to cancel and
// what to schedule, and reconcileRestAlerts applies that through an adapter. Run again after every
// write, at launch and on each return to the app, a kill between saving a rest and scheduling its
// alert heals itself. Nothing here imports expo-notifications; notifications.js is the adapter.

const PREFIX = 'rest-'

// One identifier per session: scheduling it again replaces the pending request, so a session can
// never have two.
export const restAlertId = sessionId => `${PREFIX}${sessionId}`
const isRestAlert = identifier => typeof identifier === 'string' && identifier.startsWith(PREFIX)
const ended = status => status === 'finished' || status === 'discarded'

// What the session is, for alerts, from the session hook's status and its view: 'active',
// 'finished' (in the journal, or saved and cleared) or 'discarded'. Null while it is opening or
// could not be opened: nothing is known, so nothing is changed.
export function alertStatus(sessionStatus, view) {
  if (sessionStatus === 'saved') return 'finished'
  if (sessionStatus === 'discarded') return 'discarded'
  if (sessionStatus === 'ready') return view?.status ?? null
  return null
}

// The set the workout goes to next, in the dock's words: the exercise the screen follows and its
// current work set. Null when every set is done.
export function nextSetLabel(view, names) {
  if (!view?.entries?.length) return null
  const { card, dock } = workoutScreen(view, { names, exerciseIndex: currentExerciseIndex(view) })
  return dock.number == null ? null : `Next: ${card.name}, set ${dock.number}`
}

// The alert the journal implies: one, at the deadline, while an active session's rest is running
// and has not ended. The rest is read again at `now`, so a view drawn earlier asks for nothing once
// its deadline has passed.
export function desiredRestAlert({ sessionId, status, rest, now, nextLabel }) {
  if (!sessionId || status !== 'active') return null
  const projected = projectRest(rest, now)
  if (projected?.status !== 'running' || !(projected.deadline > now)) return null
  const { deadline } = projected
  return {
    identifier: restAlertId(sessionId),
    date: deadline,
    title: 'Rest over',
    body: nextLabel || 'Back to your workout',
    data: { kind: 'rest', sessionId, deadline },
  }
}

// Exactly the desired alert: same identifier, deadline and words (an Undo during rest changes what
// is next, so the alert is rewritten).
const sameAlert = (request, desired) => desired != null
  && request.identifier === desired.identifier
  && Number(request.data?.deadline) === desired.data.deadline
  && request.body === desired.body

// `scheduled` is the pending requests ({ identifier, body, data }). Every rest alert that is not
// exactly `desired` is cancelled (another session's, a stale one); `desired` is scheduled unless it
// is already there. The desired identifier is never cancelled: scheduling it replaces the pending
// request on iOS, and a cancel then add on one identifier only adds an ordering risk. A request
// that is not a rest alert is never touched.
export function planRestAlerts(desired, scheduled) {
  const requests = scheduled ?? []
  const cancel = requests
    .filter(r => isRestAlert(r.identifier) && !sameAlert(r, desired) && r.identifier !== desired?.identifier)
    .map(r => r.identifier)
  const kept = requests.some(r => sameAlert(r, desired))
  return { cancel, schedule: desired && !kept ? desired : null }
}

// Could a schedule follow? Only an active session with a rest still running. Permission is read
// only then; every other run just cancels and needs no permission.
export const restAlertPossible = ({ sessionId, status, view, now }) => desiredRestAlert({ sessionId, status, rest: view?.rest, now }) != null

// A finished or discarded session's rest alert, already delivered, is taken out of the
// notification list: it would call the owner back to a workout that is over. With no session open
// ('none', the Start screen) none can be current, so every delivered rest alert goes.
export function deliveredToDismiss(sessionId, delivered, status) {
  if (status === 'none') return (delivered ?? []).filter(n => isRestAlert(n.identifier)).map(n => n.identifier)
  if (!sessionId || !ended(status)) return []
  const id = restAlertId(sessionId)
  return (delivered ?? []).filter(n => n.identifier === id).map(n => n.identifier)
}

// Plan, then apply through the adapter. `status` is alertStatus (or 'none' with no session open:
// every rest alert goes). Without permission ('granted') nothing is scheduled and any rest alert
// left is cancelled. Adapter errors reach the caller, which logs them; they never touch a write.
export async function reconcileRestAlerts({ sessionId, status, view, nextLabel, now, adapter, permission }) {
  if (status == null) return { cancel: [], schedule: null, dismiss: [] }
  const desired = permission === 'granted'
    ? desiredRestAlert({ sessionId, status, rest: view?.rest, now, nextLabel })
    : null
  const plan = planRestAlerts(desired, await adapter.listScheduled())
  for (const id of plan.cancel) await adapter.cancel(id)
  if (plan.schedule) await adapter.schedule(plan.schedule)
  const dismiss = status === 'none' || (sessionId && ended(status))
    ? deliveredToDismiss(sessionId, await adapter.listDelivered(), status)
    : []
  for (const id of dismiss) await adapter.dismiss(id)
  return { ...plan, dismiss }
}

// A rest alert arriving while the app is active is not presented: the dock already shows the rest
// ending and the rest-end haptic plays. Expo SDK 58 presents foreground notifications with sound
// unless told otherwise. With the app in front but inactive (Control Center, Notification Centre,
// the app switcher) that haptic does not play, so the alert shows as it would in the background,
// as does any other notification. `appActive` is AppState.currentState === 'active' as it arrives.
const SILENT = { shouldShowBanner: false, shouldShowList: false, shouldPlaySound: false, shouldSetBadge: false }
const SHOWN = { shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }
export const foregroundBehavior = (data, appActive) => (data?.kind === 'rest' && appActive === true ? SILENT : SHOWN)

// A tap on a rest alert opens the Workout tab and does nothing else.
export const isRestAlertResponse = response => response?.notification?.request?.content?.data?.kind === 'rest'
