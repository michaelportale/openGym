import { useCallback, useRef } from 'react'
import { restAlerts } from './notifications'
import { alertStatus, nextSetLabel } from './rest-alert'
import { createRestAlerts } from './rest-alerts-core'

// The app's one reconcile queue (rest-alerts-core.js), on the real adapter and clock.
const alerts = createRestAlerts({ adapter: restAlerts })

// No session open (the Start screen): no rest alert should be pending or delivered.
export const clearRestAlerts = () => alerts.clear()

// The reconcile for one session: call it when the session opens or changes state, on each return to
// the app, and after every write. `session` is the useActiveSession value, `sessionId` the base id,
// `names` the exercise names for the alert's "Next:" line. `{ restStarted: true }` is the only call
// that may ask for permission.
export function useRestAlerts({ session, sessionId, names }) {
  const latest = useRef(null)
  latest.current = { session, sessionId, names }
  return useCallback(({ restStarted = false } = {}) => alerts.reconcile(() => {
    const { session, sessionId, names } = latest.current
    const { status, view } = session.getState()
    return { sessionId, status: alertStatus(status, view), view, nextLabel: nextSetLabel(view, names) }
  }, { restStarted }), [])
}
