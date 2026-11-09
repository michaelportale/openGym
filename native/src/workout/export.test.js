import { expect, test } from 'vitest'
import { exportPayload } from './export.js'

const meta = { exportedAt: '2026-11-09T18:00:00.000Z', appVersion: '1.0.0' }
const workout = (id, d) => ({ id, d, start: Date.parse(`${d}T17:00:00Z`), entries: [{ id: '0025', sets: [{ w: 75, r: 8, done: true }] }] })

test('two workouts give JSON with both, the app and the version', () => {
  const text = exportPayload([workout('w1', '2026-11-08'), workout('w2', '2026-11-09')], meta)
  const parsed = JSON.parse(text)
  expect(parsed).toMatchObject({ app: 'opengym-native', version: 1, exportedAt: meta.exportedAt, appVersion: '1.0.0' })
  expect(parsed.workouts.map(w => w.id)).toEqual(['w1', 'w2'])
  expect(parsed.workouts[0]).toEqual(workout('w1', '2026-11-08'))
})

test('no workouts gives null, so the share sheet never opens', () => {
  expect(exportPayload([], meta)).toBeNull()
  expect(exportPayload(undefined, meta)).toBeNull()
})

test('a missing app version is written as null, not left out', () => {
  const parsed = JSON.parse(exportPayload([workout('w1', '2026-11-08')], { exportedAt: meta.exportedAt }))
  expect(parsed.appVersion).toBeNull()
})
