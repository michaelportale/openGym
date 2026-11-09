// Usage: node scripts/make-snapshot.mjs <state.json> [--out <path>]
// Writes the gitignored snapshot the app bundles, only if the transform and the check both pass.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertSameSessions, parseArgs, toSnapshot } from './snapshot.mjs'

try {
  const { input, out } = parseArgs(process.argv.slice(2))
  const target = resolve(out ?? fileURLToPath(new URL('../local/snapshot.json', import.meta.url)))
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
