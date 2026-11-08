// Node-only. scripts/ is outside the app tree Metro bundles (see nativeSourceFiles).
import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, extname, join, relative, resolve } from 'node:path'

const require = createRequire(import.meta.url)
const { parse } = require('@babel/parser')
const traverse = require('@babel/traverse').default

const SOURCE_EXT = new Set(['.js', '.jsx'])

function lineOf(node) {
  return node?.loc?.start?.line ?? 0
}

function note(file, reason, line) {
  return { file, line, reason }
}

function defaultImport(ast, suffix) {
  let local = null
  traverse(ast, {
    ImportDeclaration(path) {
      const source = path.node.source.value
      if (source !== suffix && !source.endsWith(`/${suffix}`)) return
      const spec = path.node.specifiers.find(item => item.type === 'ImportDefaultSpecifier')
      if (spec) local = spec.local.name
    }
  })
  return local
}

function componentName(binding) {
  let current = binding.path
  while (current && current.node.type !== 'FunctionDeclaration' && current.node.type !== 'FunctionExpression' && current.node.type !== 'ArrowFunctionExpression') {
    current = current.parentPath
  }
  if (!current) return null
  if (current.node.id?.name) return current.node.id.name
  const declarator = current.parentPath?.node
  if (declarator?.type === 'VariableDeclarator' && declarator.id.type === 'Identifier') return declarator.id.name
  return null
}

function propertyName(key) {
  if (key.type === 'Identifier') return key.name
  if (key.type === 'StringLiteral') return key.value
  return null
}

function closedNames(jsxPath, expression) {
  if (expression.object.type !== 'Identifier' || expression.property.type !== 'Identifier') return null
  const field = expression.property.name
  const objectBinding = jsxPath.scope.getBinding(expression.object.name)
  const lookup = objectBinding?.path.node
  if (lookup?.type !== 'VariableDeclarator' || lookup.init?.type !== 'MemberExpression') return null
  if (lookup.init.object.type !== 'Identifier') return null
  const tableBinding = jsxPath.scope.getBinding(lookup.init.object.name)
  const table = tableBinding?.path.node
  if (table?.type !== 'VariableDeclarator' || table.init?.type !== 'ObjectExpression') return null
  const names = []
  for (const prop of table.init.properties) {
    if (prop.type !== 'ObjectProperty' || prop.computed || prop.value.type !== 'ObjectExpression') return null
    const nameProp = prop.value.properties.find(item => (
      item.type === 'ObjectProperty' && !item.computed && propertyName(item.key) === field
    ))
    if (!nameProp || nameProp.value.type !== 'StringLiteral') return null
    names.push(nameProp.value.value)
  }
  return names
}

function addLiteral(names, value) {
  if (value?.type === 'StringLiteral') {
    names.add(value.value)
    return true
  }
  if (value?.type === 'JSXExpressionContainer' && value.expression.type === 'StringLiteral') {
    names.add(value.expression.value)
    return true
  }
  return false
}

function parseFile(file, unresolved) {
  try {
    return parse(file.source, { sourceType: 'module', plugins: ['jsx', 'importAttributes'] })
  } catch (error) {
    unresolved.push(note(file.filename, `could not parse: ${error.message}`, 0))
    return null
  }
}

export function scanSymbolSources(files) {
  const names = new Set()
  const unresolved = []
  const forwards = []
  const parsed = []
  for (const file of files) {
    const ast = parseFile(file, unresolved)
    if (ast) parsed.push({ ...file, ast })
  }

  for (const file of parsed) {
    const symbolLocal = defaultImport(file.ast, 'NativeSymbol')
    if (!symbolLocal) continue
    traverse(file.ast, {
      Identifier(path) {
        if (path.node.name !== symbolLocal) return
        if (path.parent.type === 'ImportDefaultSpecifier' || path.parent.type === 'JSXClosingElement') return
        if (path.parent.type === 'JSXOpeningElement' && path.parent.name === path.node) return
        unresolved.push(note(file.filename, 'NativeSymbol is used outside JSX', lineOf(path.node)))
      },
      JSXOpeningElement(path) {
        if (path.node.name.type !== 'JSXIdentifier' || path.node.name.name !== symbolLocal) return
        if (path.node.attributes.some(item => item.type === 'JSXSpreadAttribute')) {
          unresolved.push(note(file.filename, 'NativeSymbol receives a spread', lineOf(path.node)))
          return
        }
        const attr = path.node.attributes.find(item => item.type === 'JSXAttribute' && item.name?.name === 'name')
        if (!attr) {
          unresolved.push(note(file.filename, 'NativeSymbol has no name', lineOf(path.node)))
          return
        }
        if (addLiteral(names, attr.value)) return
        const expression = attr.value?.type === 'JSXExpressionContainer' ? attr.value.expression : null
        if (expression?.type === 'Identifier') {
          const binding = path.scope.getBinding(expression.name)
          const component = binding?.kind === 'param' ? componentName(binding) : null
          if (!component) {
            unresolved.push(note(file.filename, `name={${expression.name}} is not a component prop`, lineOf(expression)))
            return
          }
          forwards.push({ component, prop: expression.name, definedIn: file.filename })
          return
        }
        if (expression?.type === 'MemberExpression') {
          const closed = closedNames(path, expression)
          if (!closed) {
            unresolved.push(note(file.filename, 'name is not a closed object', lineOf(expression)))
            return
          }
          for (const name of closed) names.add(name)
          return
        }
        unresolved.push(note(file.filename, 'name is not a literal or a closed set', lineOf(path.node)))
      }
    })
  }

  for (const forward of forwards) {
    let literals = 0
    for (const file of parsed) {
      const locals = []
      if (file.filename === forward.definedIn) locals.push(forward.component)
      const imported = defaultImport(file.ast, forward.component)
      if (imported) locals.push(imported)
      if (!locals.length) continue
      traverse(file.ast, {
        JSXOpeningElement(path) {
          if (path.node.name.type !== 'JSXIdentifier' || !locals.includes(path.node.name.name)) return
          if (path.node.attributes.some(item => item.type === 'JSXSpreadAttribute')) {
            unresolved.push(note(file.filename, `${forward.component} receives a spread`, lineOf(path.node)))
            return
          }
          const attr = path.node.attributes.find(item => item.type === 'JSXAttribute' && item.name?.name === forward.prop)
          if (!attr) return
          if (addLiteral(names, attr.value)) literals += 1
          else unresolved.push(note(file.filename, `${forward.component} ${forward.prop} is not a string`, lineOf(path.node)))
        }
      })
    }
    if (literals === 0) {
      unresolved.push(note(forward.definedIn, `${forward.component} ${forward.prop} has no literal call site`, 0))
    }
  }

  return { names: [...names].sort(), unresolved }
}

export function scanSymbolTree(root) {
  const resolved = resolve(root)
  if (basename(resolved) !== 'src') {
    throw new Error(`Symbol scan root must be the app src directory: ${resolved}`)
  }
  const files = []
  const unresolved = []
  const walk = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      if (/\.test\.(js|jsx|mjs)$/.test(entry.name)) continue
      const ext = extname(entry.name)
      if (SOURCE_EXT.has(ext)) {
        files.push({ filename: relative(resolved, full), source: readFileSync(full, 'utf8') })
      } else if (ext !== '.json') {
        unresolved.push(note(relative(resolved, full), 'unscanned extension', 0))
      }
    }
  }
  walk(resolved)
  const scanned = scanSymbolSources(files)
  return {
    files: files.map(file => file.filename).sort(),
    names: scanned.names,
    unresolved: [...unresolved, ...scanned.unresolved]
  }
}
