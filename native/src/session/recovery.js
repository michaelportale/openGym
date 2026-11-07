import { openSession } from './session.js'

// A kill between writing finished_workouts and clearing the journal would otherwise
// replay that journal as a live session. The finished row wins: the leftover journal
// is dropped and open does not start that id again.

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
    const incomingDone = await alreadyFinished(finishedWorkouts, base?.id)
    if (incomingDone || (storedDone && (base == null || base.id == null))) {
      return { status: 'saved', session: null }
    }
  }
  const session = await openSession({ base, storage, now, timeZone })
  return { status: 'ready', session }
}
