// Overlapping calls share work: a call while none runs starts fn; a call while one runs queues
// exactly one more, started when it ends; calls while one is queued join it. Each call resolves
// (or rejects) with the run it joined. Pure: no I/O of its own.
export function coalesced(fn) {
  let running = null
  let queued = null
  const start = () => {
    const run = (async () => fn())()
    running = run
    const done = () => { if (running === run) running = null }
    run.then(done, done)
    return run
  }
  return () => {
    if (queued) return queued
    if (!running) return start()
    queued = running.then(() => {}, () => {}).then(() => {
      queued = null
      return start()
    })
    return queued
  }
}
