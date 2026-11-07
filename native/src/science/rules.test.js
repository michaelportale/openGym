import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { REQUIRED_FIELDS, RULES, registryProblems, whyThis } from './rules.js'

// The training rules named in docs/sprints/2026-10-30-native-workout-prd.md.
// The last table row names four inherited rules; each gets its own entry.
const PRD_RULE_IDS = [
  'warmup-loads',
  'warmup-volume',
  'warmup-prompt',
  'warmup-accounting',
  'warmup-injury',
  'rep-ranges',
  'double-progression',
  'effort-proximity',
  'weekly-volume',
  'deload-after-misses',
  'e1rm-formula',
  'rest-defaults',
  'load-increments'
]

const DOCS = join(import.meta.dirname, '../../../docs/science')

function parseFrontmatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---/)
  if (!match) throw new Error('missing frontmatter')
  const fields = {}
  for (const line of match[1].split('\n')) {
    if (!line.trim()) continue
    const splitAt = line.indexOf(':')
    if (splitAt === -1) throw new Error(`frontmatter line has no colon: ${line}`)
    fields[line.slice(0, splitAt).trim()] = line.slice(splitAt + 1).trim()
  }
  return fields
}

test('the registry has one entry per PRD rule and every entry is complete', () => {
  expect(Object.keys(RULES).sort()).toEqual([...PRD_RULE_IDS].sort())
  expect(registryProblems()).toEqual([])
  for (const rule of Object.values(RULES)) {
    for (const field of REQUIRED_FIELDS) expect(typeof rule[field]).toBe('string')
    expect(rule.reason.length).toBeGreaterThan(40)
  }
})

test('each registry entry matches its docs/science register file', () => {
  const files = readdirSync(DOCS).filter(name => name.endsWith('.md') && name !== 'README.md').sort()
  expect(files).toEqual(PRD_RULE_IDS.map(id => `${id}.md`).sort())
  for (const file of files) {
    const doc = parseFrontmatter(readFileSync(join(DOCS, file), 'utf8'))
    expect(doc.id).toBe(file.replace(/\.md$/, ''))
    const rule = RULES[doc.id]
    for (const field of [...REQUIRED_FIELDS, 'sourceUrl']) {
      expect(rule[field] ?? '').toBe(doc[field] ?? '')
    }
  }
  const readme = readFileSync(join(DOCS, 'README.md'), 'utf8')
  for (const id of PRD_RULE_IDS) expect(readme).toContain(`(${id}.md)`)
})

test('cited rules keep the PRD source, and uncited rules stay labeled convention or definition', () => {
  expect(RULES['warmup-loads'].sourceUrl).toBe('https://pmc.ncbi.nlm.nih.gov/articles/PMC7558980/')
  expect(RULES['warmup-loads'].evidence).toBe('Limited: one crossover study, bench result')
  expect(RULES['warmup-loads'].population).toBe('TODO')
  expect(RULES['warmup-volume'].sourceUrl).toBe('https://sportrxiv.org/index.php/server/preprint/view/559')
  expect(RULES['warmup-volume'].evidence).toBe('Limited')
  expect(RULES['warmup-prompt'].evidence).toBe('Our inference')
  expect(RULES['warmup-prompt'].sourceUrl).toBe('https://sportrxiv.org/index.php/server/preprint/view/559')
  expect(RULES['warmup-accounting'].source).toBe('Definition')
  expect(RULES['warmup-accounting'].sourceUrl).toBe('')
  expect(RULES['warmup-injury'].evidence).toBe('Evidence gap')
  expect(RULES['warmup-injury'].source).toContain('https://pubmed.ncbi.nlm.nih.gov/16679062/')
  expect(RULES['warmup-injury'].source).toContain('https://pubmed.ncbi.nlm.nih.gov/25694615/')
  expect(RULES['rep-ranges'].sourceUrl).toBe('https://doaj.org/article/6d51b905504d46f0873bb43d5d84bf21')
  expect(RULES['rep-ranges'].evidence).toBe('Abstract only; read in full before citing further')
  expect(RULES['double-progression'].sourceUrl).toBe('https://pmc.ncbi.nlm.nih.gov/articles/PMC9528903/')
  expect(RULES['double-progression'].evidence).toBe('The one-session trigger is convention')
  expect(RULES['effort-proximity'].sourceUrl).toBe('https://x-mol.com/paper/1810175950090465280')
  expect(RULES['effort-proximity'].evidence).toBe('Exploratory, estimated proximity')
  expect(RULES['weekly-volume'].sourceUrl).toBe('https://sponet.de/sponet/Record/4097139?lng=en')
  expect(RULES['weekly-volume'].evidence).toBe('Unverified')
  for (const id of ['deload-after-misses', 'e1rm-formula', 'rest-defaults', 'load-increments']) {
    expect(RULES[id].source).toBe('Convention')
    expect(RULES[id].evidence).toBe('Convention until audited')
    expect(RULES[id].population).toBe('Not a study')
    expect(RULES[id].sourceUrl).toBe('')
  }
})

const PRD_URLS = [
  'https://pmc.ncbi.nlm.nih.gov/articles/PMC7558980/',
  'https://sportrxiv.org/index.php/server/preprint/view/559',
  'https://pubmed.ncbi.nlm.nih.gov/16679062/',
  'https://pubmed.ncbi.nlm.nih.gov/25694615/',
  'https://doaj.org/article/6d51b905504d46f0873bb43d5d84bf21',
  'https://pmc.ncbi.nlm.nih.gov/articles/PMC9528903/',
  'https://x-mol.com/paper/1810175950090465280',
  'https://sponet.de/sponet/Record/4097139?lng=en'
]

test('whyThis returns the rule id, the plain-language reason, and the source', () => {
  const rule = RULES['warmup-accounting']
  expect(whyThis('warmup-accounting')).toEqual({
    ruleId: 'warmup-accounting',
    reason: rule.reason,
    source: rule.source
  })
  expect(whyThis('weekly-volume').source).toContain('https://sponet.de/sponet/Record/4097139?lng=en')
  expect(whyThis('weekly-volume').reason.toLowerCase()).toContain('no weekly')
})

test('whyThis fails when the rule id has no register entry', () => {
  expect(() => whyThis('not-a-rule')).toThrow(/not-a-rule/)
  expect(() => whyThis('')).toThrow(/register entry/)
})

test('entry urls are only the ones named in the PRD evidence list', () => {
  const urls = []
  for (const rule of Object.values(RULES)) {
    for (const match of `${rule.source} ${rule.sourceUrl}`.matchAll(/https?:\/\/[^\s)]+/g)) {
      urls.push(match[0].replace(/[.,]+$/, ''))
    }
  }
  expect(urls.length).toBeGreaterThan(0)
  for (const url of urls) expect(PRD_URLS).toContain(url)
})
