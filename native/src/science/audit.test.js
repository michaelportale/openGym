import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { missingRuleIds, whyThisCalls } from './audit.js'
import { RULES } from './rules.js'

const SRC = join(import.meta.dirname, '..')

function productionSources(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return productionSources(path)
    if (!entry.name.endsWith('.js') || entry.name.endsWith('.test.js')) return []
    return [{ file: path, source: readFileSync(path, 'utf8') }]
  })
}

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

test('every rule id cited in native source has a register entry', () => {
  const known = new Set(Object.keys(RULES))
  const problems = []
  for (const { file, source } of productionSources(SRC)) {
    const found = whyThisCalls(source)
    if (found.unresolved) problems.push(`${file} has a whyThis call that is not a string literal`)
    for (const id of missingRuleIds(found.literals, known)) problems.push(`${file} cites unregistered rule ${id}`)
  }
  expect(problems).toEqual([])
})
