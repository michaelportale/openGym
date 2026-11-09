import { gateSyncId, sortOwnWorkouts } from './gates.js'

const NAMES = ['save', 'retry', 'replace', 'delete']
const V1_VOLUME = 1000
const V2_VOLUME = 1500
const HOUR = 3600000

const message = e => (e && e.message) || String(e)

export async function runWorkoutGates(adapter, { nowMs }) {
  const id = gateSyncId(nowMs)
  const start = new Date(nowMs - HOUR)
  const end = new Date(nowMs)
  const gates = []
  const known = new Set()
  const find = async () => {
    try {
      const found = await adapter.findWorkoutsBySyncId(id)
      for (const w of found) known.add(w.uuid)
      return found
    } catch (e) {
      return null
    }
  }
  const save = async (version, volumeLb) => {
    const saved = await adapter.saveStrengthWorkout({ id, version, start, end, volumeLb })
    if (saved && saved.uuid) known.add(saved.uuid)
    return saved
  }
  const record = (name, ok, detail) => gates.push(ok ? { name, status: 'pass', detail } : { name, status: 'fail', detail })
  const count = found => (found ? found.length : 'unreadable')

  let saved = false
  try {
    await save(1, V1_VOLUME)
    const found = await find()
    saved = !!found && found.length === 1
    record('save', saved, 'workouts found: ' + count(found))
  } catch (e) {
    record('save', false, message(e))
  }

  if (!saved) {
    for (const name of NAMES.slice(1)) gates.push({ name, status: 'skipped' })
  } else {
    let note = ''
    try {
      await save(1, V1_VOLUME)
    } catch (e) {
      note = 'second save threw: ' + message(e) + '; '
    }
    let found = await find()
    record('retry', !!found && found.length === 1, note + 'workouts found: ' + count(found))

    note = ''
    try {
      await save(2, V2_VOLUME)
    } catch (e) {
      note = 'save threw: ' + message(e) + '; '
    }
    found = await find()
    // The adapter returns HealthKit's numeric metadata as numbers, so strict equality is right.
    const replaced = !!found && found.length === 1 && found[0].syncVersion === 2 && found[0].volumeLb === V2_VOLUME
    record('replace', replaced, note + 'workouts found: ' + count(found) + (found && found[0] ? ', version ' + found[0].syncVersion : ''))

    note = ''
    for (const w of found || []) {
      try {
        await adapter.deleteWorkout(w.uuid)
      } catch (e) {
        note = 'delete threw: ' + message(e) + '; '
      }
    }
    found = await find()
    record('delete', !!found && found.length === 0, note + 'workouts left: ' + count(found))
  }

  const found = await find()
  for (const uuid of found ? found.map(w => w.uuid) : known) {
    try {
      await adapter.deleteWorkout(uuid)
    } catch (e) {}
  }
  const left = await find()
  return { gates, leftovers: left ? left.length : null }
}

// Clears gate workouts from every run, including ones an interrupted run left behind. Anything
// without a gate id is only counted, never deleted. A failed read rejects, so it can't look like
// there was nothing to remove.
export async function removeGateWorkouts(adapter, ownBundleId) {
  const read = async () => sortOwnWorkouts(await adapter.findOwnWorkouts(ownBundleId), ownBundleId)
  let removed = 0
  let error
  for (const w of (await read()).gate) {
    try {
      removed += await adapter.deleteWorkout(w.uuid)
    } catch (e) {
      error = message(e)
    }
  }
  const { gate, other } = await read()
  return { removed, left: gate.length, other: other.length, error }
}
