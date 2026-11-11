// A routine screen's writes, one after another. Each write is { routine, base, fresh }: the whole
// routine, the base routine it was made on (the copy's or the snapshot's, without the overlay;
// its _ts is the edit's baseTs), and whether that base is the snapshot's (plan-view.js editBase).
// The last write's pair is shown at once, ahead of the store, until every write has run and the
// screen has rendered the store since: rapid taps each build on what is on screen, and so does a
// tap landing after the last write but before the screen re-renders from the store (that tap,
// built on the store's older routine, would undo it).
//
// The base travels with the routine. It is taken from the store once, when a chain starts, and a
// newer base arriving mid-chain (a sync storing the web's version) is never paired with a routine
// made before it: that pair would be put on the new base and overwrite the web's change. With the
// old base the guard rebases the phone's own landed push or supersedes it with the notice.
//
// `save(next)` resolves { ok } (a throw reads as not ok); `onAhead(pair | null)` hears each change.
// `seen(stored)`: the store's pair the screen rendered, told on each render. Once every write has
// run, the chain's pair goes when a render shows a stored routine that holds it, or one read from
// the store after the chain settled (the store moved on: a sync took the web's version); at once
// when the last write failed (the store never took it). Pure apart from the injected save.
import { sameRoutine } from '../sync/edit-guard.js'

const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v)

export function createWriteChain(save, onAhead = () => {}) {
  let ahead = null
  let queue = Promise.resolve()
  let pending = 0
  let shown // the stored routine the screen last rendered
  let settledOn = null // { routine }: what was shown when the chain settled with ahead kept

  const holds = routine => isObj(routine) && isObj(ahead.routine) && sameRoutine(routine, ahead.routine)
  const clear = () => {
    ahead = null
    settledOn = null
    onAhead(null)
  }

  const settle = result => {
    pending -= 1
    if (pending === 0 && ahead) {
      if (!result.ok || holds(shown)) clear()
      else settledOn = { routine: shown }
    }
    return result
  }

  return {
    // What the next edit builds on: the chain's pair while it is ahead, else `stored`.
    from: stored => ahead ?? stored,
    ahead: () => ahead,
    seen(stored) {
      shown = stored?.routine
      if (settledOn && (holds(shown) || shown !== settledOn.routine)) clear()
    },
    // Queues one write and shows it at once. A failed write does not stop the later ones: each
    // carries the whole routine, so the last one to land holds every change before it.
    commit(next) {
      ahead = next
      settledOn = null
      onAhead(next)
      pending += 1
      const run = queue.then(() => save(next)).then(result => result ?? { ok: false }, () => ({ ok: false }))
      queue = run
      return run.then(settle)
    },
    // Resolves when every write started so far has finished. It does not write. A delete, once
    // confirmed, waits on this so a commit already running cannot land after the delete.
    settled: () => queue,
  }
}
