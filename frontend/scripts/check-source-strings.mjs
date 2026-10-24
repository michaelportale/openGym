#!/usr/bin/env node
// The companion to check-locales.mjs, which compares the locale packs to each other and so
// cannot see a key that is missing from all of them: that renders English in every language
// while every check stays green. This walks src/ instead, collects the literals actually
// passed to t(), and reports the ones no pack defines.
//
//   node scripts/check-source-strings.mjs          # report only, exit 0
//   node scripts/check-source-strings.mjs --strict # exit 1 if anything is missing
//
// English is the source language and has no pack, so the key IS the English string.
// Literal calls are collected, and so are the literal branches of a conditional first argument,
// t(on ? 'Pause' : 'Resume'), whose keys are as fixed as a literal's. t(variable), lookups such
// as t(NAMES[k]) and template literals are resolved at runtime and stay out of scope.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const srcDir = join(root, 'src')
const localesDir = join(srcDir, 'locales')
const strict = process.argv.includes('--strict')

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      if (p === localesDir || name === 'instr' || name === 'node_modules') continue
      walk(p, out)
    } else if (/\.(js|jsx)$/.test(name) && !/\.test\.(js|jsx)$/.test(name)) {
      out.push(p)
    }
  }
  return out
}

// t('literal') / t("literal") — preceded by a non-identifier char so DateTimeFormat( misses.
const CALL = /(^|[^A-Za-z0-9_$.])t\(\s*(['"])((?:\\.|(?!\2)[^\\])*)\2/g

// The first argument of every t( call, read up to its top-level comma or closing paren.
const OPEN = /(^|[^A-Za-z0-9_$.])t\(/g
export function firstArgs(text) {
  const out = []
  for (const m of text.matchAll(OPEN)) {
    let arg = '', depth = 0
    for (let i = m.index + m[0].length; i < text.length; i++) {
      const c = text[i]
      if (c === '"' || c === "'" || c === '`') {
        let j = i + 1
        while (j < text.length && text[j] !== c) { if (text[j] === '\\') j++; j++ }
        arg += text.slice(i, j + 1); i = j; continue
      }
      if ('([{'.includes(c)) depth++
      else if (')]}'.includes(c)) { if (depth === 0) break; depth-- }
      else if (c === ',' && depth === 0) break
      arg += c
    }
    out.push(arg)
  }
  return out
}
// The literal results of a conditional first argument: the strings right after ? or :.
const BRANCH = /[?:]\s*(['"])((?:\\.|(?!\1)[^\\])*)\1/g
export function branchKeys(text) {
  const keys = []
  for (const arg of firstArgs(text)) {
    if (/^\s*(['"])(?:\\.|(?!\1)[^\\])*\1\s*$/.test(arg)) continue
    for (const b of arg.matchAll(BRANCH)) keys.push(b[2].replace(/\\(['"\\])/g, '$1'))
  }
  return keys
}

const used = new Map()
const note = (key, file) => {
  if (!key) return
  if (!used.has(key)) used.set(key, new Set())
  used.get(key).add(relative(root, file))
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
for (const file of walk(srcDir)) {
  const text = readFileSync(file, 'utf8')
  for (const m of text.matchAll(CALL)) note(m[3].replace(/\\(['"\\])/g, '$1'), file)
  for (const key of branchKeys(text)) note(key, file)
}

const defined = new Set()
for (const file of readdirSync(localesDir).filter(f => f.endsWith('.js'))) {
  const pack = (await import(pathToFileURL(join(localesDir, file)).href)).default
  for (const key of Object.keys(pack)) defined.add(key)
}

const missing = [...used.keys()].filter(k => !defined.has(k)).sort()

if (!missing.length) {
  console.log(`${used.size} translated strings in src/, all present in the locale packs.`)
  process.exit(0)
}

console.log(`${used.size} translated strings in src/, ${missing.length} defined in no locale pack:\n`)
for (const key of missing) {
  console.log(`  ${JSON.stringify(key)}`)
  for (const f of [...used.get(key)].sort()) console.log(`      ${f}`)
}
console.log(`\nThese render English in all ${readdirSync(localesDir).filter(f => f.endsWith('.js')).length} translated languages.`)
process.exit(strict ? 1 : 0)
}
