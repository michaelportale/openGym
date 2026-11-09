import { ALERTS_OFF_NOTICE, restBegan, shouldExplainAlertsOff } from '../notify/permission.js'
import { writeOutcome } from './set-calls.js'

// The words for "rest alerts are off" after a write, or null. Only a result afterGatedWrite marked
// `alertsOff`, and never over something the write already says (a failure, a warning, "Rest didn't
// start"). `explained` is the Set of session ids already told; the id is added only when the
// notice is returned, so a write that had to say something else leaves it for the next.
export function alertsOffNotice(result, action, sessionId, explained) {
  if (!result?.alertsOff || writeOutcome(result, action) || !shouldExplainAlertsOff(sessionId, explained)) return null
  explained.add(sessionId)
  return ALERTS_OFF_NOTICE
}

// What happens once a gated write has settled, outside the gate. Pure apart from calling the
// `afterWrite` it is given (useRestAlerts' reconcile).
//   result      the gate's result. A dropped tap ({ ignored: true }) wrote nothing: nothing runs.
//   before      the journal's rest as the write began; `after()` reads it again now.
//   afterWrite  called with { restStarted }; it may answer { step, asked } when a rest started.
//   quiet       a write the owner did not tap (the rest restored on open): never a rest start, so it
//               never asks for permission (never at launch) and is never marked.
// A follow-up that throws or rejects is logged and never reaches the write. When a rest started,
// permission is 'off' and the owner was not just asked, the result carries `alertsOff: true` (a new
// object; the write's own result is not changed) so the screen can say alerts are off. A write that
// failed is never marked: its failure is what the screen says.
export async function afterGatedWrite(result, { afterWrite, before, after, now, quiet = false }) {
  if (result?.ignored) return result
  const warn = error => console.warn('Rest alert follow-up failed:', error?.message ?? error)
  let answer = null
  let restStarted = false
  try {
    restStarted = !quiet && restBegan(before, after(), now)
    // Only a started rest waits for the answer (it may ask for permission); any other write does
    // not hold its result for the reconcile.
    if (restStarted) answer = await afterWrite?.({ restStarted })
    else Promise.resolve(afterWrite?.({ restStarted })).catch(warn)
  } catch (error) {
    warn(error)
    return result
  }
  const marked = restStarted && answer?.step === 'off' && answer.asked !== true && result && result.ok !== false
  return marked ? { ...result, alertsOff: true } : result
}
