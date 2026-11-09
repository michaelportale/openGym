import { restBegan } from '../notify/permission.js'

// What happens once a gated write has settled, outside the gate. Pure apart from calling the
// `afterWrite` it is given (useRestAlerts' reconcile).
//   result      the gate's result. A dropped tap ({ ignored: true }) wrote nothing: nothing runs.
//   before      the journal's rest as the write began; `after()` reads it again now.
//   afterWrite  called with { restStarted }; it may answer { step, asked } when a rest started.
// A follow-up that throws or rejects is logged and never reaches the write. When a rest started,
// permission is 'off' and the owner was not just asked, the result carries `alertsOff: true` (a new
// object; the write's own result is not changed) so the screen can say alerts are off. A write that
// failed is never marked: its failure is what the screen says.
export async function afterGatedWrite(result, { afterWrite, before, after, now }) {
  if (result?.ignored) return result
  const warn = error => console.warn('Rest alert follow-up failed:', error?.message ?? error)
  let answer = null
  let restStarted = false
  try {
    restStarted = restBegan(before, after(), now)
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
