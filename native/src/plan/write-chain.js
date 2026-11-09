// A routine screen's writes, one after another. Each write is { routine, base }: the whole
// routine, and the base routine it was made on (the copy's or the snapshot's, without the
// overlay; its _ts is the edit's baseTs). The last write's pair is shown at once, ahead of the
// store, until every write has run, so rapid taps each build on what is on screen.
//
// The base travels with the routine. It is taken from the store once, when a chain starts, and a
// newer base arriving mid-chain (a sync storing the web's version) is never paired with a routine
// made before it: that pair would be put on the new base and overwrite the web's change. With the
// old base the guard rebases the phone's own landed push or supersedes it with the notice.
//
// `save(next)` resolves { ok } (a throw reads as not ok); `onAhead(pair | null)` hears each change.
// Pure apart from the injected save.
export function createWriteChain(save, onAhead = () => {}) {
  let ahead = null
  let queue = Promise.resolve()
  let pending = 0

  const settle = result => {
    pending -= 1
    if (pending === 0) {
      ahead = null
      onAhead(null)
    }
    return result
  }

  return {
    // What the next edit builds on: the chain's pair while one runs, else `stored`.
    from: stored => ahead ?? stored,
    ahead: () => ahead,
    // Queues one write and shows it at once. A failed write does not stop the later ones: each
    // carries the whole routine, so the last one to land holds every change before it.
    commit(next) {
      ahead = next
      onAhead(next)
      pending += 1
      const run = queue.then(() => save(next)).then(result => result ?? { ok: false }, () => ({ ok: false }))
      queue = run
      return run.then(settle)
    },
  }
}
