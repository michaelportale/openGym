import { readFileSync, writeFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { openSession, plannedSetId } from './session.js'
import { createMemoryStorage } from './storage.js'
import { toWorkoutPayload } from './finish.js'

// The MCP server's test (mcp/test/phone-workout.test.js) reads this file instead of importing
// native code, which would drag in the React Native toolchain. Here the fixture is built from the
// real session and toWorkoutPayload, and compared with what is on disk, so it cannot drift from
// what the phone sends. Regenerate with: PHONE_FIXTURE_UPDATE=1 npx vitest run phone-fixture
const FIXTURE = new URL('../../../mcp/test/fixtures/phone-workout.json', import.meta.url)
const T0 = Date.parse('2026-11-07T15:00:00.000Z')

const base = {
  id: '6f1c2d0e-5b8a-4c53-9a47-1d2e3f405162',
  d: '2026-11-07',
  start: T0,
  name: 'Phone Push',
  bw: 80,
  routineIds: ['routine-1'],
  entries: [
    {
      id: '0025', // bench press (chest)
      target: { sets: 3, reps: 5, weight: 60 },
      sets: [
        { w: 65, r: 8, done: false, phase: 'warmup' },
        { w: 60, r: 5, done: false },
        { w: 62.5, r: 5, done: false },
      ],
    },
    {
      id: '0986', // one-arm curl: one set logged per side
      target: { sets: 1, reps: 10 },
      sets: [{ w: 10, r: 20, done: false, sides: { L: { w: 10, r: 10, done: false }, R: { w: 10, r: 10, done: false } } }],
    },
  ],
}

async function build() {
  let t = T0 + 60_000
  const session = await openSession({ base, storage: createMemoryStorage(), now: () => t, timeZone: 'UTC' })
  const commit = (exerciseId, i, fields, extra = {}) => session.commitSet({ eventId: `${exerciseId}-${i}`, exerciseId, setId: plannedSetId(exerciseId, i), fields, ...extra })
  await commit('0025', 0, { w: 65, r: 8, phase: 'warmup' })
  t += 60_000
  await commit('0025', 1, { w: 60, r: 5, rir: 3 })
  t += 60_000
  await commit('0025', 2, { w: 62.5, r: 5, rir: 1 })
  t += 60_000
  await commit('0986', 0, { w: 10, r: 10 }, { side: 'L' })
  await commit('0986', 0, { w: 10, r: 10 }, { side: 'R' })
  t += 60_000
  await session.finish({ eventId: 'finish-1' })
  return toWorkoutPayload(session.view().finished).workout
}

test('the MCP phone-workout fixture is what the phone sends', async () => {
  const workout = await build()
  const bench = workout.entries.find(e => e.id === '0025')
  expect(bench.sets[0].phase).toBe('warmup')
  expect(bench.sets.map(s => s.rir)).toEqual([undefined, 3, 1])
  expect(workout.entries.find(e => e.id === '0986').sets[0].sides).toBeTruthy()
  if (process.env.PHONE_FIXTURE_UPDATE) writeFileSync(FIXTURE, JSON.stringify(workout, null, 2) + '\n')
  expect(JSON.parse(readFileSync(FIXTURE, 'utf8'))).toEqual(JSON.parse(JSON.stringify(workout)))
})
