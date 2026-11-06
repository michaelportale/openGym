#!/usr/bin/env node
/* Does the shared training logic still load under plain node, and is its import graph free of
 * browser-only code?
 *
 * native/ imports frontend/src/lib in place. vitest (Vite) and Metro both tolerate things that
 * a React Native runtime does not, so this runs by bare `node` on purpose, following
 * mcp/scripts/check-node-loadable.mjs. Do not port it to a vitest test file.
 */
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { nativeSourceFiles, scanNativeBoundary, scanSharedGraph } from './shared-lib-graph.mjs'

const ENTRY = fileURLToPath(new URL('../src/shared/training.js', import.meta.url))

const NATIVE = resolve(fileURLToPath(new URL('..', import.meta.url)))
const FRONTEND = fileURLToPath(new URL('../../frontend', import.meta.url))

let failed = 0

try {
  await import(ENTRY)
  console.log('  ok    training.js loads under plain node')
} catch (e) {
  failed++
  console.error(`  FAIL  training.js — ${e.message}`)
}

const { files, violations } = scanSharedGraph(ENTRY)
console.log(`  scanned ${files.length} files`)
for (const v of violations) {
  failed++
  console.error(`  FAIL  ${v.file} — ${v.token}`)
}

const nativeFiles = nativeSourceFiles(NATIVE).filter(f => f !== ENTRY)
for (const v of scanNativeBoundary(nativeFiles, FRONTEND)) {
  failed++
  console.error(`  FAIL  ${v.file} — imports ${v.spec} (only training.js may import frontend/)`)
}
console.log(`  checked ${nativeFiles.length} native files for direct frontend/ imports`)

if (failed) {
  console.error(`\n${failed} problem(s): the shared logic is not safe for native.`)
  process.exit(1)
}
console.log('\nthe shared import graph is clean.')
