import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { nativeSourceFiles, scanNativeBoundary, scanSharedGraph } from './shared-lib-graph.mjs'

const fixture = name => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))

test('follows relative imports and reports no violations for clean code', () => {
  const { files, violations } = scanSharedGraph(fixture('clean-entry.js'))
  expect(files.map(f => basename(f)).sort()).toEqual(['clean-dep.js', 'clean-entry.js'])
  expect(violations).toEqual([])
})

test('names the file and token for a bare import and a browser global', () => {
  const { violations } = scanSharedGraph(fixture('bad-entry.js'))
  expect(violations.map(v => v.token)).toEqual(expect.arrayContaining(['@capacitor/core', 'localStorage']))
  expect(violations.every(v => basename(v.file) === 'bad-entry.js')).toBe(true)
})

test('ignores comments', () => {
  expect(scanSharedGraph(fixture('commented-entry.js')).violations).toEqual([])
})

const tokensOf = name => scanSharedGraph(fixture(name)).violations.map(v => v.token)

test('a /* inside a string does not hide the code after it', () => {
  expect(tokensOf('string-comment-entry.js')).toEqual(expect.arrayContaining(['@capacitor/core', 'localStorage']))
})

test('a // inside a string does not hide the rest of the line', () => {
  expect(tokensOf('string-slashes-entry.js')).toContain('localStorage')
})

test.each([
  ['optional-window.js', 'window.'],
  ['optional-document.js', 'document.'],
  ['optional-navigator.js', 'navigator.']
])('catches optional chaining on %s', (name, token) => {
  expect(tokensOf(name)).toContain(token)
})

test.each(['global-this-entry.js', 'self-entry.js', 'window-storage-entry.js'])(
  'catches storage reached through a global object in %s',
  name => {
    expect(tokensOf(name)).toContain('localStorage')
  }
)

test('window.localStorage reports both globals', () => {
  expect(tokensOf('window-storage-entry.js')).toEqual(expect.arrayContaining(['localStorage', 'window.']))
})

test('ordinary properties and string contents are not flagged', () => {
  expect(tokensOf('property-entry.js')).toEqual([])
})

test.each([
  'no-space-import-brace.js',
  'no-space-import-from.js',
  'no-space-import-side-effect.js',
  'no-space-export-brace.js',
  'no-space-export-star.js'
])('reports a bare import written without spaces in %s', name => {
  expect(tokensOf(name)).toEqual(['@capacitor/core'])
})

test('follows a relative import written without spaces into its subtree', () => {
  const { files, violations } = scanSharedGraph(fixture('no-space-relative-entry.js'))
  expect(files.map(f => basename(f))).toContain('bad-entry.js')
  expect(violations.map(v => basename(v.file))).toContain('bad-entry.js')
})

test('a string ending in the word import does not hide the real import after it', () => {
  expect(tokensOf('string-import-entry.js')).toEqual(['@capacitor/core'])
})

test('import text inside a string or template is not an import', () => {
  expect(tokensOf('string-content-entry.js')).toEqual([])
})

test('identifiers, keys and strings that look like keywords are not imports', () => {
  expect(tokensOf('keyword-lookalike-entry.js')).toEqual([])
})

test('flags require() and a non-literal import()', () => {
  expect(tokensOf('require-entry.js')).toContain('require(')
  expect(tokensOf('dynamic-import-entry.js')).toContain('import(')
})

test('flags imports that resolve to mobile.js or i18n.js', () => {
  expect(tokensOf('banned-entry.js')).toEqual(expect.arrayContaining(['mobile.js', 'i18n.js']))
})

test('follows JSON files without scanning them', () => {
  const { files, violations } = scanSharedGraph(fixture('json-entry.js'))
  expect(files.map(f => basename(f))).toContain('data.json')
  expect(violations).toEqual([])
})

test('flags a relative import that does not resolve', () => {
  expect(tokensOf('missing-entry.js')).toContain('./does-not-exist.js')
})

test('native boundary: names files that import from frontend/', () => {
  const dir = fixture('boundary')
  const files = ['ok.js', 'bad.js', 'sibling.js'].map(n => `${dir}/native/${n}`)
  const violations = scanNativeBoundary(files, `${dir}/frontend`)
  expect(violations.map(v => basename(v.file))).toEqual(['bad.js'])
  expect(violations[0].spec).toBe('../frontend/lib.js')
})

// Built in a temp directory: native/.gitignore would drop committed fixtures named dist/ or .expo/.
const withTree = (paths, run) => {
  const root = mkdtempSync(join(tmpdir(), 'opengym-native-tree-'))
  try {
    for (const [path, body] of Object.entries(paths)) {
      const file = join(root, path)
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, body)
    }
    return run(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('native source walk covers app code anywhere and skips generated, tooling and test files', () => {
  const paths = [
    'App.js', 'index.js', 'metro.config.js',
    'app/index.tsx', 'components/Card.jsx', 'theme/tokens.ts', 'src/a.js', 'src/deep/b.mjs',
    'src/scripts/x.js', 'components/ios/Y.jsx',
    'src/a.test.js', 'src/b.test.mjs', 'components/Card.test.jsx',
    'node_modules/x/index.js', 'ios/Pods/p.js', 'android/a.js', 'dist/d.js', 'web-build/w.js',
    '.expo/e.js', 'scripts/s.mjs', 'assets/icon.png', 'app.json'
  ]
  const found = withTree(Object.fromEntries(paths.map(p => [p, ''])), root =>
    nativeSourceFiles(root).map(f => relative(root, f)).sort())
  expect(found).toEqual([
    'App.js', 'app/index.tsx', 'components/Card.jsx', 'components/ios/Y.jsx', 'index.js', 'metro.config.js',
    'src/a.js', 'src/deep/b.mjs', 'src/scripts/x.js', 'theme/tokens.ts'
  ])
})

test('a UI file outside src/ that imports from frontend/ is a violation', () => {
  const violations = withTree({
    'native/components/Card.jsx': "import { lib } from '../../frontend/lib.js'\nexport const Card = () => lib\n",
    'native/src/ok.js': 'export const ok = 1\n',
    'frontend/lib.js': 'export const lib = 1\n'
  }, root => scanNativeBoundary(nativeSourceFiles(join(root, 'native')), join(root, 'frontend'))
    .map(v => ({ file: relative(root, v.file), spec: v.spec })))
  expect(violations).toEqual([{ file: 'native/components/Card.jsx', spec: '../../frontend/lib.js' }])
})

test.each([
  ['regex-backtick-entry.js', 'localStorage'],
  ['regex-quote-entry.js', 'localStorage'],
  ['bracket-entry.js', 'localStorage'],
  ['alias-entry.js', 'window.'],
  ['typeof-window-entry.js', 'window.'],
  ['location-entry.js', 'location.'],
  ['history-entry.js', 'history.'],
  ['match-media-entry.js', 'matchMedia'],
  ['meta-glob-entry.js', 'import.meta.glob']
])('reports the browser-only reference in %s', (name, token) => {
  expect(tokensOf(name)).toContain(token)
})

test('a local or parameter named like a global is not flagged', () => {
  expect(tokensOf('shadowed-globals-entry.js')).toEqual([])
})

test('an unparseable file is a violation, not a pass', () => {
  expect(tokensOf('broken-entry.js')).toEqual(['unparseable'])
})

test('a JSX apostrophe does not hide a frontend import after it', () => {
  const violations = withTree({
    'native/Card.js': "export const A = () => <Text>don't</Text>\nimport { lib } from '../frontend/lib.js'\n",
    'frontend/lib.js': 'export const lib = 1\n'
  }, root => scanNativeBoundary(nativeSourceFiles(join(root, 'native')), join(root, 'frontend')).map(v => v.spec))
  expect(violations).toEqual(['../frontend/lib.js'])
})

test('an unparseable native file is a boundary violation', () => {
  const specs = withTree({ 'native/Bad.js': 'export const = 1\n', 'frontend/lib.js': '' },
    root => scanNativeBoundary(nativeSourceFiles(join(root, 'native')), join(root, 'frontend')).map(v => v.spec))
  expect(specs).toEqual(['unparseable'])
})
