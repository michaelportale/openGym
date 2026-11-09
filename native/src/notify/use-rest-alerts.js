import { useCallback, useRef } from 'react'
import { restAlerts } from './notifications'
import { readStep, stepForRestStart } from './permission'
import { alertStatus, nextSetLabel, reconcileRestAlerts, restAlertPossible } from './rest-alert'

// One reconcile at a time, app-wide, each reading the journal when it runs rather than when it was
// asked for: two overlapping runs could otherwise land an older deadline last. The last run after
// the last write is the one that counts. Every failure is logged and swallowed, so the promise
// never rejects (it resolves to the job's answer, or null) and nothing a write reports depends on it.
let queue = Promise.resolve()
function enqueue(job) {
  const run = queue.then(async () => {
    try {
      return await job()
    } catch (error) {
      console.warn('Rest alert not updated:', error?.message ?? error)
      return null
    }
  })
  queue = run
  return run
}

// The system prompt is asked for at most once per launch, and only when a rest starts.
let asked = false

// One reconcile. `read()` is the journal now: { sessionId, status, view, nextLabel }.
// Permission is read only when a schedule could follow (an active session with a rest running); a
// read that fails counts as 'off', so the run still cancels. When `restStarted`, a step of 'ask' is
// asked for here, and the journal is read again after the prompt: the owner may have taken a while.
// Answers { step, asked } when permission was consulted, else null.
async function run(read, restStarted) {
  let answer = null
  let permission = 'off'
  if (restAlertPossible({ ...read(), now: Date.now() })) {
    answer = restStarted
      ? await stepForRestStart({ read: restAlerts.permissions, request: restAlerts.request, mayAsk: !asked })
      : { step: await readStep(restAlerts.permissions), asked: false }
    if (answer.asked) asked = true
    permission = answer.step
  }
  await reconcileRestAlerts({ ...read(), now: Date.now(), adapter: restAlerts, permission })
  return answer
}

// No session open (the Start screen): no rest alert should be pending or delivered.
const NO_SESSION = () => ({ sessionId: null, status: 'none', view: null, nextLabel: null })
export const clearRestAlerts = () => enqueue(() => run(NO_SESSION, false))

// The reconcile for one session: call it when the session opens or changes state, on each return to
// the app, and after every write. `session` is the useActiveSession value, `sessionId` the base id,
// `names` the exercise names for the alert's "Next:" line. `{ restStarted: true }` (a Complete that
// started a rest, a Start rest retry) is the only call that may ask for permission.
export function useRestAlerts({ session, sessionId, names }) {
  const latest = useRef(null)
  latest.current = { session, sessionId, names }
  return useCallback(({ restStarted = false } = {}) => enqueue(() => run(() => {
    const { session, sessionId, names } = latest.current
    const { status, view } = session.getState()
    return { sessionId, status: alertStatus(status, view), view, nextLabel: nextSetLabel(view, names) }
  }, restStarted)), [])
}
