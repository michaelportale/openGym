import { expect, test } from 'vitest'
import { createMemoryStorage } from './storage.js'
import { openSession } from './session.js'

const T0 = Date.parse('2026-11-07T15:00:00.000Z')

function baseWorkout() {
  return {
    id: 'session-1',
    d: '2026-11-07',
    start: T0,
    name: 'Push',
    routineIds: ['routine-1'],
    entries: [
      {
        id: 'bench',
        target: { sets: 1, reps: 5, weight: 60 },
        sets: [{ w: 60, r: 5, done: false }],
      },
      {
        id: 'row',
        target: { sets: 1, reps: 8 },
        sets: [{ w: 40, r: 8, done: false }],
      },
    ],
  }
}

const doneSides = {
  w: 20,
  r: 16,
  done: true,
  sides: {
    L: { w: 20, r: 8, done: true },
    R: { w: 18, r: 8, done: true },
  },
}

function oneSide(leftDone, rightDone) {
  return {
    sides: {
      L: { w: 20, r: 8, done: leftDone },
      R: { w: 18, r: 8, done: rightDone },
    },
  }
}

function isPerSide(row) {
  return !!(row && row.sides && row.sides.L && row.sides.R)
}

function sideFacts(view) {
  const facts = []
  for (const entry of view.entries) {
    for (const set of entry.sets) {
      if (!isPerSide(set.row)) continue
      const left = set.row.sides.L.done === true
      const right = set.row.sides.R.done === true
      facts.push({
        id: `${entry.id}/${set.setId}`,
        done: set.row.done === true,
        left,
        right,
        agreed: (set.row.done === true) === (left && right),
      })
    }
  }
  return facts
}

async function started(storage) {
  return openSession({
    base: baseWorkout(),
    storage,
    now: () => T0 + 60_000,
    timeZone: 'UTC',
  })
}

test('per-side row.done follows both ticks after every set change, live and on replay', async () => {
  const storage = createMemoryStorage()
  const session = await started(storage)
  let step = 0

  async function run(label, command) {
    step += 1
    const result = await command()
    expect(result, label).toMatchObject({ ok: true, saved: true })
    const live = sideFacts(session.view())
    const restored = await openSession({ storage, now: () => T0 + 60_000, timeZone: 'UTC' })
    const replay = sideFacts(restored.view())
    expect({ step, label, live, replay }).toEqual({
      step,
      label,
      live: live.map(fact => ({ ...fact, agreed: true })),
      replay: live.map(fact => ({ ...fact, agreed: true })),
    })
    return restored.view()
  }

  await run('add a copied per-side set', () => session.addSet({
    eventId: 'add-side',
    exerciseId: 'bench',
    setId: 'side',
    fields: doneSides,
  }))
  await run('commit both sides', () => session.commitSet({
    eventId: 'commit-side',
    exerciseId: 'bench',
    setId: 'side',
    fields: { w: 22 },
  }))
  await run('edit one side off', () => session.editSet({
    eventId: 'edit-one',
    exerciseId: 'bench',
    setId: 'side',
    fields: oneSide(true, false),
  }))
  await run('undo the per-side set', () => session.undoSet({
    eventId: 'undo-side',
    exerciseId: 'bench',
    setId: 'side',
  }))
  await run('commit naming one side', () => session.commitSet({
    eventId: 'commit-one',
    exerciseId: 'bench',
    setId: 'side',
    fields: oneSide(true, false),
  }))
  await run('copy the per-side shape onto a new set', () => session.addSet({
    eventId: 'copy-side',
    exerciseId: 'row',
    setId: 'copied',
    fields: doneSides,
  }))
  await run('move the exercise that holds the copy', () => session.moveExercise({
    eventId: 'move-row',
    exerciseId: 'row',
    toIndex: 0,
  }))
  await run('edit the copy so both sides are done', () => session.editSet({
    eventId: 'edit-copy',
    exerciseId: 'row',
    setId: 'copied',
    fields: oneSide(true, true),
  }))
  await run('add a plain set', () => session.addSet({
    eventId: 'add-plain',
    exerciseId: 'bench',
    setId: 'plain',
    fields: { w: 60, r: 5, done: true },
  }))
  const afterPlain = await run('commit the plain set', () => session.commitSet({
    eventId: 'commit-plain',
    exerciseId: 'bench',
    setId: 'plain',
    fields: { w: 62, r: 5 },
  }))
  const plain = afterPlain.entries.find(entry => entry.id === 'bench').sets.find(set => set.setId === 'plain')
  expect(plain.row.done).toBe(true)
  expect(plain.row.sides).toBeUndefined()

  await run('turn the plain set into one finished side', () => session.editSet({
    eventId: 'edit-plain-side',
    exerciseId: 'bench',
    setId: 'plain',
    fields: oneSide(true, false),
  }))
  await run('undo that set', () => session.undoSet({
    eventId: 'undo-plain',
    exerciseId: 'bench',
    setId: 'plain',
  }))

  const curlId = 'curl'
  await run('copy an exercise that already has a finished per-side set', () => session.addExercise({
    eventId: 'copy-curl',
    exerciseId: curlId,
    entry: {
      id: curlId,
      target: { sets: 2, reps: 8 },
      sets: [
        { id: 'curl-side', ...doneSides },
        { id: 'curl-plain', w: 12, r: 10, done: true },
      ],
    },
  }))
  await run('commit the copied per-side set', () => session.commitSet({
    eventId: 'commit-curl-side',
    exerciseId: curlId,
    setId: 'curl-side',
    fields: { w: 24 },
  }))
  await run('edit the copied set down to one side', () => session.editSet({
    eventId: 'edit-curl-side',
    exerciseId: curlId,
    setId: 'curl-side',
    fields: oneSide(false, true),
  }))
  await run('undo the copied per-side set', () => session.undoSet({
    eventId: 'undo-curl-side',
    exerciseId: curlId,
    setId: 'curl-side',
  }))
  await run('move the copied exercise', () => session.moveExercise({
    eventId: 'move-curl',
    exerciseId: curlId,
    toIndex: 1,
  }))
  await run('commit the copied plain set', () => session.commitSet({
    eventId: 'commit-curl-plain',
    exerciseId: curlId,
    setId: 'curl-plain',
    fields: { r: 12 },
  }))
})
