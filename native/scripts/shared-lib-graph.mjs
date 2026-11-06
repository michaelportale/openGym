import { readFileSync, existsSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'

// Tokens that only exist in a browser or in the web build's tooling. `window.` etc. are matched
// with a leading word boundary so `myWindow.x` is not flagged.
const TOKENS = [
  'localStorage', 'sessionStorage', 'indexedDB',
  'document.', 'navigator.', 'window.', 'import.meta.glob'
]
const BANNED_FILES = ['mobile.js', 'i18n.js']

const stripComments = src => src.replace(/\/\*[\s\S]*?\*\/|(^|[^:'"`\\])\/\/[^\n]*/g, '$1')

const SPECIFIER = [
  /\bimport\s+(?:[\w*{}\s,$]+?\s+from\s+)?['"]([^'"]+)['"]/g,
  /\bexport\s+(?:[\w*{}\s,$]+?)\s+from\s+['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g
]

const specifiersOf = code => SPECIFIER.flatMap(re => [...code.matchAll(re)].map(m => m[1]))

export function scanSharedGraph(entryFile, allow = {}) {
  const files = []
  const violations = []
  const seen = new Set()

  const visit = file => {
    if (seen.has(file)) return
    seen.add(file)
    files.push(file)
    if (file.endsWith('.json')) return

    const code = stripComments(readFileSync(file, 'utf8'))
    const allowed = new Set(allow[basename(file)] || [])
    const flag = token => {
      if (!allowed.has(token)) violations.push({ file, token })
    }

    for (const token of TOKENS) {
      const escaped = token.replace(/\./g, '\\.')
      if (new RegExp(`(?<![\\w$.])${escaped}`).test(code)) flag(token)
    }

    for (const spec of specifiersOf(code)) {
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
