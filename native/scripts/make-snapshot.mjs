// Usage: node scripts/make-snapshot.mjs <state.json> [--out <path>]
// Writes the gitignored snapshot the app bundles, only if the transform and the check both pass.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertSameSessions, toSnapshot } from './snapshot.mjs'

const args = process.argv.slice(2)
const outAt = args.indexOf('--out')
const out = outAt >= 0 ? args.splice(outAt, 2)[1] : null
const input = args[0]
const target = resolve(out || fileURLToPath(new URL('../local/snapshot.json', import.meta.url)))

try {
  if (!input) throw new Error('usage: make-snapshot.mjs <state.json> [--out <path>]')
  const state = JSON.parse(readFileSync(input, 'utf8'))
  const snap = toSnapshot(state)
  assertSameSessions(state, snap)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, JSON.stringify(snap, null, 2) + '\n')
  console.log(`snapshot: ${snap.state.routines.length} routines, ${(snap.state.workouts || []).length} workouts, ${Object.keys(snap.names).length} exercises -> ${target}`)
} catch (e) {
  console.error(e.message)
  process.exit(1)
}
