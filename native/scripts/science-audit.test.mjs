import { readFileSync } from 'node:fs'
import { relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { RULES } from '../src/science/rules.js'
import { auditSourceFiles, missingRuleIds, problemsInTree, whyThisCalls } from './science-audit.mjs'

const fromHere = name => fileURLToPath(new URL(name, import.meta.url))
const fixtureRoot = fromHere('./fixtures/why-this-tree/')
const nativeRoot = fromHere('..')

test('a whyThis literal missing from the register is reported', () => {
  const found = whyThisCalls(`export const x = whyThis('not-a-rule')\n`)
  expect(found.literals).toEqual(['not-a-rule'])
  expect(found.unresolved).toBe(0)
  expect(missingRuleIds(found.literals, new Set(['warmup-loads']))).toEqual(['not-a-rule'])
})

test('a non-literal whyThis call cannot be checked and is unresolved', () => {
  const found = whyThisCalls(`whyThis(ruleId)\n`)
  expect(found.literals).toEqual([])
  expect(found.unresolved).toBe(1)
})

test('comments and other calls are not rule ids', () => {
  const found = whyThisCalls(`
    // whyThis('not-a-rule')
    const label = 'not-a-rule'
    cite('not-a-rule')
    whyThis('warmup-accounting')
  `)
  expect(found).toEqual({ literals: ['warmup-accounting'], unresolved: 0 })
})

test('an unknown or non-literal whyThis in a tsx file fails, and an mjs file is scanned too', () => {
  const problems = problemsInTree(fixtureRoot, new Set(['warmup-accounting']))
  expect(problems).toEqual([
    'Screen.tsx: unregistered rule not-a-real-rule',
    'Screen.tsx: whyThis argument is not a string literal',
    'note.mjs: unregistered rule also-not-real'
  ])
})

test('the native audit covers js, jsx, mjs, ts, and tsx, and skips this fixture', () => {
  const files = auditSourceFiles(nativeRoot).map(file => relative(nativeRoot, file))
  expect(files.some(file => file.startsWith('src/') && file.endsWith('.js'))).toBe(true)
  expect(files.some(file => file.includes('why-this-tree'))).toBe(false)
  expect(files.every(file => /\.(js|jsx|mjs|ts|tsx)$/.test(file))).toBe(true)
  const screen = readFileSync(fromHere('./fixtures/why-this-tree/Screen.tsx'), 'utf8')
  expect(whyThisCalls(screen, 'Screen.tsx').literals).toEqual(['not-a-real-rule'])
})

test('every rule id cited under native/ has a register entry', () => {
  expect(problemsInTree(nativeRoot, new Set(Object.keys(RULES)))).toEqual([])
})
