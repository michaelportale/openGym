import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, extname, join, resolve, sep } from 'node:path'

const require = createRequire(import.meta.url)
const { parse } = require('@babel/parser')
const traverse = require('@babel/traverse').default

// Object globals report as `name.`; the rest report by bare name.
const OBJECT_GLOBALS = ['window', 'document', 'navigator', 'location', 'history']
const BARE_GLOBALS = ['localStorage', 'sessionStorage', 'indexedDB', 'matchMedia', 'Notification', 'caches']
const TOKEN = new Map([...OBJECT_GLOBALS.map(n => [n, `${n}.`]), ...BARE_GLOBALS.map(n => [n, n])])
// Unbound names through which a global is reachable: `globalThis.localStorage`, `self['caches']`.
const GLOBAL_OBJECTS = new Set(['globalThis', 'self', 'window', 'global'])
const BANNED_FILES = ['mobile.js', 'i18n.js']
const UNPARSEABLE = 'unparseable'

const pluginsFor = file => {
  const ext = extname(file)
  const plugins = ['importAttributes']
  if (ext === '.ts') plugins.push('typescript')
  else if (ext === '.tsx') plugins.push('jsx', 'typescript')
  else plugins.push('jsx')
  return plugins
}

const isFree = (path, name) => !path.scope.hasBinding(name, { noGlobals: true })

// Parses one file. Returns the browser-only tokens it uses and the module requests it makes, or
// `unparseable` when it is not valid source: a file that cannot be read cannot be vouched for.
export function scanSource(file) {
  const tokens = new Set()
  const requests = new Set()
  let ast
  try {
    ast = parse(readFileSync(file, 'utf8'), { sourceType: 'module', plugins: pluginsFor(file) })
  } catch {
    return { tokens: [UNPARSEABLE], requests: [] }
  }

  const dynamic = arg => {
    if (arg && arg.type === 'StringLiteral') requests.add(arg.value)
    else tokens.add('import(')
  }

  traverse(ast, {
    // Visitors must return nothing, so these are statements, not expression arrows.
    ImportDeclaration(path) {
      requests.add(path.node.source.value)
    },
    ExportNamedDeclaration(path) {
      if (path.node.source) requests.add(path.node.source.value)
    },
    ExportAllDeclaration(path) {
      requests.add(path.node.source.value)
    },
    ImportExpression(path) {
      dynamic(path.node.source)
    },
    CallExpression(path) {
      const { callee, arguments: args } = path.node
      if (callee.type === 'Import') dynamic(args[0])
      else if (callee.type === 'Identifier' && callee.name === 'require' && isFree(path, 'require')) tokens.add('require(')
    },
    Identifier(path) {
      const { name } = path.node
      if (TOKEN.has(name) && path.isReferencedIdentifier() && isFree(path, name)) tokens.add(TOKEN.get(name))
    },
    'MemberExpression|OptionalMemberExpression'(path) {
      const { object, property, computed } = path.node
      if (object.type === 'MetaProperty' && !computed && property.name === 'glob') tokens.add('import.meta.glob')
      if (object.type !== 'Identifier' || !GLOBAL_OBJECTS.has(object.name) || !isFree(path, object.name)) return
      const name = computed ? (property.type === 'StringLiteral' ? property.value : null) : property.name
      if (TOKEN.has(name)) tokens.add(TOKEN.get(name))
    }
  })
  return { tokens: [...tokens], requests: [...requests] }
}

export function scanSharedGraph(entryFile) {
  const files = []
  const violations = []
  const seen = new Set()

  const visit = file => {
    if (seen.has(file)) return
    seen.add(file)
    files.push(file)
    if (file.endsWith('.json')) return

    const flag = token => violations.push({ file, token })
    const { tokens, requests } = scanSource(file)
    tokens.forEach(flag)

    for (const spec of requests) {
      if (!spec.startsWith('.')) {
        flag(spec)
        continue
      }
      const target = resolve(dirname(file), spec)
      if (BANNED_FILES.includes(basename(target))) flag(basename(target))
      if (existsSync(target)) visit(target)
      else flag(spec)
    }
  }

  visit(resolve(entryFile))
  return { files, violations }
}

const NOT_APP_CODE = new Set(['node_modules', 'ios', 'android', 'dist', 'web-build', '.expo', 'scripts'])
const SOURCE_FILE = /\.(js|jsx|ts|tsx|mjs|cjs)$/
const TEST_FILE = /\.test\.\w+$/

// Everything Metro could bundle from native/. It walks instead of listing folders, so a new folder
// is covered by default. Skips apply at the top level only: src/scripts/ is still app code.
export function nativeSourceFiles(root) {
  const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const path = join(dir, e.name)
    if (e.isDirectory()) return dir === root && NOT_APP_CODE.has(e.name) ? [] : walk(path)
    return SOURCE_FILE.test(e.name) && !TEST_FILE.test(e.name) ? [path] : []
  })
  return walk(root)
}

// Files outside training.js must not reach into frontend/ themselves, or Metro bundles it
// without the graph scan ever seeing it.
export function scanNativeBoundary(files, frontendDir) {
  const root = resolve(frontendDir)
  const violations = []
  for (const file of files) {
    const { tokens, requests } = scanSource(file)
    if (tokens.includes(UNPARSEABLE)) violations.push({ file, spec: UNPARSEABLE })
    for (const spec of requests) {
      if (!spec.startsWith('.')) continue
      const target = resolve(dirname(file), spec)
      if (target === root || target.startsWith(root + sep)) violations.push({ file, spec })
    }
  }
  return violations
}
