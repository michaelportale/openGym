import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, join, resolve, sep } from 'node:path'

// Tokens that only exist in a browser or in the web build's tooling. Property tokens match
// `x.` and `x?.`; storage globals match bare. A preceding `.` only exempts ordinary properties
// (`obj.document.x`), never a global object (`globalThis.localStorage`, `window.localStorage`).
const BARE = ['localStorage', 'sessionStorage', 'indexedDB']
const PROPERTY = ['document', 'navigator', 'window']
const GLOBAL_OBJECTS = '(?:globalThis|self|window|global)'
const BANNED_FILES = ['mobile.js', 'i18n.js']

const TOKENS = [
  ...BARE.map(name => ({ token: name, re: `${name}\\b` })),
  ...PROPERTY.map(name => ({ token: `${name}.`, re: `${name}\\s*\\??\\.` })),
  { token: 'import.meta.glob', re: 'import\\.meta\\.glob' }
]

// Blanks comments and returns two same-length views: `text` keeps string contents (specifiers
// live there), `code` blanks them too. Respects ', " and template literals with ${} nesting.
export function sanitize(src) {
  let text = ''
  let code = ''
  const braces = []
  const emit = (t, c) => {
    text += t
    code += c
  }
  const blank = s => s.replace(/[^\n]/g, ' ')
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    const next = src[i + 1]
    if (ch === '/' && next === '/') {
      let j = src.indexOf('\n', i)
      if (j < 0) j = src.length
      emit(blank(src.slice(i, j)), blank(src.slice(i, j)))
      i = j
    } else if (ch === '/' && next === '*') {
      let j = src.indexOf('*/', i + 2)
      j = j < 0 ? src.length : j + 2
      emit(blank(src.slice(i, j)), blank(src.slice(i, j)))
      i = j
    } else if (ch === "'" || ch === '"') {
      let j = i + 1
      while (j < src.length && src[j] !== ch && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1
      j = Math.min(j + 1, src.length)
      emit(src.slice(i, j), ch + blank(src.slice(i + 1, j - 1)) + (j - i > 1 ? src[j - 1] : ''))
      i = j
    } else if (ch === '`' || (ch === '}' && braces[braces.length - 1] === 'tpl')) {
      if (ch === '}') braces.pop()
      let j = i + 1
      while (j < src.length && src[j] !== '`' && !(src[j] === '$' && src[j + 1] === '{')) j += src[j] === '\\' ? 2 : 1
      j = Math.min(j, src.length)
      const body = src.slice(i + 1, j)
      if (src[j] === '$') {
        braces.push('tpl')
        emit(ch + body + '${', ch + blank(body) + '${')
        i = j + 2
      } else {
        emit(ch + body + (src[j] || ''), ch + blank(body) + (src[j] || ''))
        i = j + 1
      }
    } else {
      if (ch === '{') braces.push('{')
      else if (ch === '}') braces.pop()
      emit(ch, ch)
      i++
    }
  }
  return { text, code }
}

// Sticky: each is tried only at a keyword found in `code`, so a string can neither start a match
// nor swallow the real import after it. No whitespace is required: `import{a}from'x'` is valid.
const KEYWORD = /(?<![\w$.])(?:import|export|require)\b/g
const SPECIFIER = [
  /import\b\s*(?:[\w*{}\s,$]+?\bfrom\s*)?['"]([^'"\n]+)['"]/y,
  /export\b\s*[\w*{}\s,$]+?\bfrom\s*['"]([^'"\n]+)['"]/y,
  /import\s*\(\s*['"]([^'"\n]+)['"]\s*\)/y,
  /require\s*\(\s*['"]([^'"\n]+)['"]\s*\)/y
]

// Specifiers whose keyword sits in real code (not inside a string), plus dynamic forms that
// cannot be followed statically.
export function specifiersOf({ text, code }) {
  const found = new Set()
  for (const { index } of code.matchAll(KEYWORD)) {
    for (const re of SPECIFIER) {
      re.lastIndex = index
      const m = re.exec(text)
      if (m) found.add(m[1])
    }
  }
  const specs = [...found]
  const dynamic = []
  for (const m of code.matchAll(/(?<![\w$.])(import|require)\s*\(/g)) {
    const literal = /^\s*(['"])[^'"\n]*\1\s*\)/.test(text.slice(m.index + m[0].length))
    if (m[1] === 'require' || !literal) dynamic.push(`${m[1]}(`)
  }
  return { specs, dynamic: [...new Set(dynamic)] }
}

const violationsFor = code => {
  const found = []
  for (const { token, re } of TOKENS) {
    const bare = new RegExp(`(?<![\\w$.])${re}`)
    const viaGlobal = new RegExp(`(?<![\\w$])${GLOBAL_OBJECTS}\\s*\\??\\.\\s*${re}`)
    if (bare.test(code) || viaGlobal.test(code)) found.push(token)
  }
  return found
}

export function scanSharedGraph(entryFile, allow = {}) {
  const files = []
  const violations = []
  const seen = new Set()

  const visit = file => {
    if (seen.has(file)) return
    seen.add(file)
    files.push(file)
    if (file.endsWith('.json')) return

    const clean = sanitize(readFileSync(file, 'utf8'))
    const allowed = new Set(allow[basename(file)] || [])
    const flag = token => {
      if (!allowed.has(token)) violations.push({ file, token })
    }

    violationsFor(clean.code).forEach(flag)

    const { specs, dynamic } = specifiersOf(clean)
    dynamic.forEach(flag)
    for (const spec of specs) {
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
    const { specs } = specifiersOf(sanitize(readFileSync(file, 'utf8')))
    for (const spec of specs) {
      if (!spec.startsWith('.')) continue
      const target = resolve(dirname(file), spec)
      if (target === root || target.startsWith(root + sep)) violations.push({ file, spec })
    }
  }
  return violations
}
