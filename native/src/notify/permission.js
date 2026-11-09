import { projectRest } from '../session/timing.js'

// Notification permission, in the three steps the screen cares about. Pure: notifications.js reads
// and asks, this decides. Nothing here imports expo-notifications.

// iOS authorization statuses (expo-notifications IosAuthorizationStatus): 0 not determined,
// 1 denied, 2 authorized, 3 provisional, 4 ephemeral. Expo reports provisional as status
// 'undetermined' with granted false, so the iOS status is read too.
const IOS_ALLOWED = [2, 3, 4]
export const alertsAllowed = permissions => permissions?.granted === true || IOS_ALLOWED.includes(permissions?.ios?.status)

// 'granted' (an alert can show), 'ask' (never asked: the system prompt is still available) or
// 'off' (denied, or unknown).
export function permissionStep(permissions) {
  if (alertsAllowed(permissions)) return 'granted'
  const iosStatus = permissions?.ios?.status
  if (permissions?.status === 'undetermined' && (iosStatus == null || iosStatus === 0)) return 'ask'
  return 'off'
}

// The options the one in-context request is made with.
export const REQUEST_OPTIONS = { ios: { allowAlert: true, allowSound: true, allowBadge: false } }

export const ALERTS_OFF_NOTICE = 'Rest alerts are off. Turn on notifications for openGym in Settings to get one when rest ends.'

// The permission as a step; a read that rejects counts as 'off'.
export async function readStep(read) {
  try {
    return permissionStep(await read())
  } catch (error) {
    console.warn('Notification permission not read:', error?.message ?? error)
    return 'off'
  }
}

// Say "alerts are off" once for each session id. `explained` is a Set of the ids already told.
export const shouldExplainAlertsOff = (sessionId, explained) => Boolean(sessionId) && !explained.has(sessionId)

// A rest began with this write: it runs after the write and did not run, at that deadline, before.
export function restBegan(before, after, now) {
  if (projectRest(after, now)?.status !== 'running') return false
  return !(before && before.status === 'running' && before.deadline === after.deadline)
}
