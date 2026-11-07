import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { extname, relative } from 'node:path'
import { nativeSourceFiles } from './shared-lib-graph.mjs'

const require = createRequire(import.meta.url)
const { parse } = require('@babel/parser')
const traverse = require('@babel/traverse').default

// App source the audit reads. .mjs is included so a script-shaped module under native/src
// cannot cite a rule the register does not have. The walker itself lives in scripts/.
const AUDIT_EXT = new Set(['.js', '.jsx', '.mjs', '.ts', '.tsx'])

function pluginsFor(filename) {
  const ext = extname(filename)
  const plugins = ['importAttributes']
  if (ext === '.ts') plugins.push('typescript')
  else if (ext === '.tsx') plugins.push('jsx', 'typescript')
  else plugins.push('jsx')
  return plugins
}

function isImportedOrFree(path) {
  const binding = path.scope.getBinding('whyThis')
  return !binding || binding.kind === 'module'
}

/** String arguments to whyThis, plus how many calls could not be checked. */
export function whyThisCalls(source, filename = 'file.js') {
  const literals = []
  let unresolved = 0
  const ast = parse(source, { sourceType: 'module', plugins: pluginsFor(filename) })
  traverse(ast, {
    CallExpression(path) {
      const { callee, arguments: args } = path.node
      if (callee.type !== 'Identifier' || callee.name !== 'whyThis' || !isImportedOrFree(path)) return
      const arg = args[0]
      if (arg && arg.type === 'StringLiteral') literals.push(arg.value)
      else unresolved += 1
    }
  })
  return { literals, unresolved }
}

/** Rule ids cited in code that the register does not contain. */
export function missingRuleIds(used, known) {
  return [...used].filter(id => !known.has(id)).sort()
}

/** Bundleable native files whose extension this audit understands. */
export function auditSourceFiles(root) {
  return nativeSourceFiles(root).filter(file => AUDIT_EXT.has(extname(file)))
}

/** Problems in one tree. Empty means every whyThis literal is registered and checkable. */
export function problemsInTree(root, known) {
  const problems = []
  for (const file of auditSourceFiles(root)) {
    const rel = relative(root, file)
    const found = whyThisCalls(readFileSync(file, 'utf8'), file)
    if (found.unresolved) problems.push(`${rel}: whyThis argument is not a string literal`)
    for (const id of missingRuleIds(found.literals, known)) problems.push(`${rel}: unregistered rule ${id}`)
  }
  return problems.sort()
}
