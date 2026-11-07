import { openSession } from './session.js'

// A kill between writing finished_workouts and clearing the journal would otherwise
// replay that journal as a live session. The finished row wins for that same id:
// the leftover journal is dropped and open does not start it again.
//
// A stored journal for a different id that is not finished is the session to restore.
// An incoming base that is already finished does not hide it.

async function alreadyFinished(finishedWorkouts, id) {
  if (typeof id !== 'string' || id === '') return false
  const saved = await finishedWorkouts.get(id)
  return !!saved
}

export async function openRecovered({ base, storage, finishedWorkouts, now, timeZone } = {}) {
  if (finishedWorkouts) {
    const storedBase = await storage.readBase()
    const storedDone = await alreadyFinished(finishedWorkouts, storedBase?.id)
    if (storedDone) await storage.clear()
    // Restore the open journal before considering the caller's base. A finished
    // incoming id must not leave that journal sitting unopened.
    const unfinishedJournal = !!storedBase && !storedDone
    const incomingDone = await alreadyFinished(finishedWorkouts, base?.id)
    if (!unfinishedJournal && (incomingDone || (storedDone && (base == null || base.id == null)))) {
      return { status: 'saved', session: null }
    }
  }
  const session = await openSession({ base, storage, now, timeZone })
  return { status: 'ready', session }
}
