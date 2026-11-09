import * as Notifications from 'expo-notifications'
import { foregroundBehavior, isRestAlertResponse } from './rest-alert'

// The thin adapter over expo-notifications. Decisions live in rest-alert.js (tested); this only
// translates. Every call is async and throws to its caller, which logs it: an alert never changes
// a write. Local notifications only: no push token is ever asked for.

// A request as the planner reads it.
const flat = request => ({
  identifier: request?.identifier,
  title: request?.content?.title ?? null,
  body: request?.content?.body ?? null,
  data: request?.content?.data ?? null,
})

export const restAlerts = {
  // The current status, never a prompt.
  permissions: () => Notifications.getPermissionsAsync(),
  // The in-context request: the system prompt, shown by iOS at most once.
  request: options => Notifications.requestPermissionsAsync(options),
  listScheduled: async () => (await Notifications.getAllScheduledNotificationsAsync()).map(flat),
  // `sound: true` is the system's notification sound, which Focus and silent mode govern.
  schedule: ({ identifier, date, title, body, data }) => Notifications.scheduleNotificationAsync({
    identifier,
    content: { title, body, data, sound: true },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(date) },
  }),
  cancel: identifier => Notifications.cancelScheduledNotificationAsync(identifier),
  listDelivered: async () => (await Notifications.getPresentedNotificationsAsync()).map(n => flat(n.request)),
  dismiss: identifier => Notifications.dismissNotificationAsync(identifier),
}

// Once, at module load of the root layout: a rest alert arriving with the app open is not shown.
export function setRestAlertHandler() {
  try {
    Notifications.setNotificationHandler({
      handleNotification: async notification => foregroundBehavior(notification?.request?.content?.data),
    })
  } catch (error) {
    console.warn('Rest alert handler not set:', error?.message ?? error)
  }
}

// A tap on a rest alert, whether it opened the app or reached it running, calls `open` and does
// nothing else. Returns the unsubscribe.
export function onRestAlertTap(open) {
  const handle = response => {
    if (!isRestAlertResponse(response)) return
    try {
      open()
    } catch (error) {
      console.warn('Rest alert tap not routed:', error?.message ?? error)
    }
  }
  try {
    handle(Notifications.getLastNotificationResponse())
    const subscription = Notifications.addNotificationResponseReceivedListener(handle)
    return () => subscription.remove()
  } catch (error) {
    console.warn('Rest alert taps not followed:', error?.message ?? error)
    return () => {}
  }
}
