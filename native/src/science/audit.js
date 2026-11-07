import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { parse } = require('@babel/parser')
const traverse = require('@babel/traverse').default

function isImportedOrFree(path) {
  const binding = path.scope.getBinding('whyThis')
  return !binding || binding.kind === 'module'
}

/** String arguments to whyThis, plus how many calls could not be checked. */
export function whyThisCalls(source) {
  const literals = []
  let unresolved = 0
  const ast = parse(source, { sourceType: 'module', plugins: ['jsx', 'importAttributes'] })
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
