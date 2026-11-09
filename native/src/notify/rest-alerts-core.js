import { REQUEST_OPTIONS, permissionStep, readStep } from './permission.js'
import { reconcileRestAlerts, restAlertPossible } from './rest-alert.js'

// The reconcile queue and the in-context permission ask, with the adapter and clock injected so it
// is testable. use-rest-alerts.js builds the app's one instance with the real adapter. Nothing here
// imports expo-notifications.

// How long a rest-starting write waits for the system prompt to be answered before it carries on
// as if alerts were off. The prompt itself is never waited on inside the queue.
export const ASK_WAIT_MS = 30_000

// How long one queued job (a reconcile's native calls) may take before the queue moves on without
// it. A native call that never settles would otherwise stall every later reconcile and every write
// waiting on one. A job that times out is logged; the next reconcile reads the journal afresh.
export const JOB_WAIT_MS = 10_000

const NO_SESSION = () => ({ sessionId: null, status: 'none', view: null, nextLabel: null })

// Whether a rest-starting write waits for its reconcile's answer. Only one that may ask for
// permission does: no step known yet, or 'ask' with the prompt not yet shown this launch. Every
// other rest start is answered at once from the step last read, and its reconcile runs on its own.
export const restStartWaits = (known, asked) => known == null || (known === 'ask' && !asked)

// The adapter one queued job runs against. A timeout abandons a job but cannot stop it: a native
// call that answers late would let it carry on from its old journal snapshot after newer jobs have
// run. Once the job is no longer live (timed out, or done), its changes (schedule, cancel, dismiss)
// warn and throw instead of acting; the throw ends the abandoned job. Reads pass through.
function jobAdapter(adapter, isLive) {
  const read = name => (...args) => adapter[name](...args)
  const change = name => (...args) => {
    if (!isLive()) {
      console.warn(`Rest alert ${name} skipped: its job timed out`)
      throw new Error(`${name} after the job timed out`)
    }
    return adapter[name](...args)
  }
  return {
    live: isLive,
    permissions: read('permissions'),
    listScheduled: read('listScheduled'),
    listDelivered: read('listDelivered'),
    schedule: change('schedule'),
    cancel: change('cancel'),
    dismiss: change('dismiss'),
  }
}

export function createRestAlerts({ adapter, now = Date.now, waitMs = ASK_WAIT_MS, jobWaitMs = JOB_WAIT_MS }) {
  // One reconcile at a time, each reading the journal when it runs rather than when it was asked
  // for. Every failure, a timeout included, is logged and swallowed, so the promise never rejects
  // (it resolves to the job's answer, or null) and nothing a write reports depends on it. `job` is
  // given its own adapter (jobAdapter), which stops changing anything once the job is not live.
  let queue = Promise.resolve()
  const enqueue = job => {
    const next = queue.then(async () => {
      let live = true
      let timer
      const timeout = new Promise((_resolve, reject) => {
        timer = setTimeout(() => {
          live = false
          reject(new Error(`timed out after ${jobWaitMs} ms`))
        }, jobWaitMs)
      })
      try {
        return await Promise.race([job(jobAdapter(adapter, () => live)), timeout])
      } catch (error) {
        console.warn('Rest alert not updated:', error?.message ?? error)
        return null
      } finally {
        live = false
        clearTimeout(timer)
      }
    })
    queue = next
    return next
  }

  // The system prompt is requested at most once per launch; this is set before it is awaited.
  let asked = false
  // The permission step last read or answered; null before any. Notification permission only
  // changes in Settings, away from the app, so it is read again on open and on each return
  // (`fresh`), and forgotten until that read lands.
  let known = null
  const readKnown = async job => (known = await readStep(job.permissions))

  const apply = (job, read, permission) => reconcileRestAlerts({ ...read(), now: now(), adapter: job, permission })

  // One reconcile. Permission is read only when a schedule could follow (an active session with a
  // rest running); a read that fails counts as 'off', so the run still cancels. When a rest
  // started and the step is 'ask', the request is begun here but not awaited: this run reconciles
  // as 'off' and returns the pending answer, so an unanswered prompt cannot hold the queue.
  async function run(job, read, restStarted) {
    if (!restAlertPossible({ ...read(), now: now() })) {
      await apply(job, read, 'off')
      return null
    }
    const step = await readKnown(job)
    if (!restStarted || step !== 'ask' || asked) {
      await apply(job, read, step)
      return { step, asked: false }
    }
    // A run abandoned while it read never asks late; a later rest start asks instead.
    if (!job.live()) return null
    asked = true
    const pending = Promise.resolve()
      .then(() => adapter.request(REQUEST_OPTIONS))
      .then(permissionStep, error => {
        console.warn('Notification permission not requested:', error?.message ?? error)
        return 'off'
      })
      .then(answer => (known = answer))
    await apply(job, read, 'off')
    return { pending }
  }

  // After every write, on open and on return: `{ restStarted: true }` (a Complete that started a
  // rest, a Start rest retry) is the only call that may ask. It answers { step, asked } when
  // permission was consulted, else null. Only a rest start that may ask (restStartWaits) waits for
  // its run, and for the prompt's answer as long as `waitMs`; any other is answered at once from the
  // step last read. An answer that arrives after the wait still reconciles. `{ fresh: true }` (on
  // open and on each return to the app) reads the permission again first.
  function reconcile(read, { restStarted = false, fresh = false } = {}) {
    if (fresh) {
      known = null
      // A hung read here delays the jobs queued behind it by at most JOB_WAIT_MS; it never blocks them.
      enqueue(readKnown)
    }
    const queued = enqueue(job => run(job, read, restStarted))
    if (!restStarted) return queued
    if (!restStartWaits(known, asked)) return Promise.resolve({ step: known, asked: false })
    return queued.then(async out => {
      if (!out?.pending) return out
      out.pending.then(step => enqueue(job => apply(job, read, step)))
      let timer
      const timeout = new Promise(resolve => { timer = setTimeout(() => resolve(null), waitMs) })
      const step = await Promise.race([out.pending, timeout])
      clearTimeout(timer)
      return step == null ? { step: 'off', asked: false } : { step, asked: true }
    })
  }

  return { reconcile, clear: () => reconcile(NO_SESSION) }
}
