import { useCallback, useRef } from 'react'
import { restAlerts } from './notifications'
import { alertStatus, alertsAllowed, nextSetLabel, reconcileRestAlerts } from './rest-alert'

// The permission as it stands, read and never asked for. Task 3's in-context request replaces this
// getter; until then only an owner who already allowed notifications gets alerts.
export const currentPermission = async () => (alertsAllowed(await restAlerts.permissions()) ? 'granted' : 'off')

// One reconcile at a time, app-wide, each reading the journal when it runs rather than when it was
// asked for: two overlapping runs could otherwise land an older deadline last. The last run after
// the last write is the one that counts. Every failure is logged and swallowed, so the promise
// never rejects and nothing a write reports depends on it.
let queue = Promise.resolve()
function enqueue(read, permission = currentPermission) {
  queue = queue.then(async () => {
    try {
      const allowed = await permission()
      await reconcileRestAlerts({ ...read(), now: Date.now(), adapter: restAlerts, permission: allowed })
    } catch (error) {
      console.warn('Rest alert not updated:', error?.message ?? error)
    }
  })
  return queue
}

// No session open (the Start screen): no rest alert should be pending.
export const clearRestAlerts = () => enqueue(() => ({ sessionId: null, status: 'none', view: null, nextLabel: null }))

// The reconcile for one session: call it when the session opens or changes state, on each return to
// the app, and after every write. `session` is the useActiveSession value, `sessionId` the base id,
// `names` the exercise names for the alert's "Next:" line.
export function useRestAlerts({ session, sessionId, names, permission }) {
  const latest = useRef(null)
  latest.current = { session, sessionId, names, permission }
  return useCallback(() => enqueue(() => {
    const { session, sessionId, names } = latest.current
    const { status, view } = session.getState()
    return { sessionId, status: alertStatus(status, view), view, nextLabel: nextSetLabel(view, names) }
  }, latest.current.permission), [])
}
