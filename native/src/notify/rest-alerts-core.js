import { REQUEST_OPTIONS, permissionStep, readStep } from './permission.js'
import { reconcileRestAlerts, restAlertPossible } from './rest-alert.js'

// The reconcile queue and the in-context permission ask, with the adapter and clock injected so it
// is testable. use-rest-alerts.js builds the app's one instance with the real adapter. Nothing here
// imports expo-notifications.

// How long a rest-starting write waits for the system prompt to be answered before it carries on
// as if alerts were off. The prompt itself is never waited on inside the queue.
export const ASK_WAIT_MS = 30_000

const NO_SESSION = () => ({ sessionId: null, status: 'none', view: null, nextLabel: null })

export function createRestAlerts({ adapter, now = Date.now, waitMs = ASK_WAIT_MS }) {
  // One reconcile at a time, each reading the journal when it runs rather than when it was asked
  // for. Every failure is logged and swallowed, so the promise never rejects (it resolves to the
  // job's answer, or null) and nothing a write reports depends on it.
  let queue = Promise.resolve()
  const enqueue = job => {
    const next = queue.then(async () => {
      try {
        return await job()
      } catch (error) {
        console.warn('Rest alert not updated:', error?.message ?? error)
        return null
      }
    })
    queue = next
    return next
  }

  // The system prompt is requested at most once per launch; this is set before it is awaited.
  let asked = false

  const apply = (read, permission) => reconcileRestAlerts({ ...read(), now: now(), adapter, permission })

  // One reconcile. Permission is read only when a schedule could follow (an active session with a
  // rest running); a read that fails counts as 'off', so the run still cancels. When a rest
  // started and the step is 'ask', the request is begun here but not awaited: this run reconciles
  // as 'off' and returns the pending answer, so an unanswered prompt cannot hold the queue.
  async function run(read, restStarted) {
    if (!restAlertPossible({ ...read(), now: now() })) {
      await apply(read, 'off')
      return null
    }
    const step = await readStep(adapter.permissions)
    if (!restStarted || step !== 'ask' || asked) {
      await apply(read, step)
      return { step, asked: false }
    }
    asked = true
    const pending = Promise.resolve()
      .then(() => adapter.request(REQUEST_OPTIONS))
      .then(permissionStep, error => {
        console.warn('Notification permission not requested:', error?.message ?? error)
        return 'off'
      })
    await apply(read, 'off')
    return { pending }
  }

  // After every write, on open and on return: `{ restStarted: true }` (a Complete that started a
  // rest, a Start rest retry) is the only call that may ask. It answers { step, asked } when
  // permission was consulted, else null. An answer that arrives after the wait still reconciles.
  function reconcile(read, { restStarted = false } = {}) {
    const queued = enqueue(() => run(read, restStarted))
    if (!restStarted) return queued
    return queued.then(async out => {
      if (!out?.pending) return out
      out.pending.then(step => enqueue(() => apply(read, step)))
      let timer
      const timeout = new Promise(resolve => { timer = setTimeout(() => resolve(null), waitMs) })
      const step = await Promise.race([out.pending, timeout])
      clearTimeout(timer)
      return step == null ? { step: 'off', asked: false } : { step, asked: true }
    })
  }

  return { reconcile, clear: () => reconcile(NO_SESSION) }
}
