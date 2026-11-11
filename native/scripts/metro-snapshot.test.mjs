import { describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const source = readFileSync(new URL('../metro.config.js', import.meta.url), 'utf8')
const root = path.resolve('/opengym/native')
const local = path.join(root, 'local/snapshot.json')
const example = path.join(root, 'src/data/snapshot.example.json')

// Exercise the real config without starting Metro or accessing the owner's snapshot.
function loadConfig(env = {}, exists = () => true) {
  const module = { exports: {} }
  vm.runInNewContext(source, {
    module, __dirname: root, process: { env },
    require(name) {
      if (name === 'fs') return { existsSync: exists }
      if (name === 'path') return path
      if (name === 'expo/metro-config') return {
        getDefaultConfig: () => ({ resolver: {}, cacheVersion: 'expo-default' })
      }
      throw new Error(`Unexpected config dependency: ${name}`)
    }
  })
  return module.exports
}

const resolveSnapshot = config => config.resolver.resolveRequest({}, '@opengym/snapshot', 'ios')

describe('distribution snapshots', () => {
  test.each([
    { ACTION: 'install', CONFIGURATION: 'Release' },
    { ACTION: 'archive', CONFIGURATION: 'Release' },
    { ACTION: 'install', OPENGYM_DISTRIBUTION: '0' },
    { OPENGYM_DISTRIBUTION: '1' }
  ])('uses only example data for %j, even with a local snapshot', env => {
    expect(resolveSnapshot(loadConfig(env))).toEqual({ type: 'sourceFile', filePath: example })
  })

  test('does not even inspect the personal snapshot during an archive', () => {
    const config = loadConfig({ ACTION: 'install' }, () => { throw new Error('Private file accessed') })
    expect(resolveSnapshot(config).filePath).toBe(example)
  })

  test('rejects a misspelled explicit distribution flag rather than bundling personal data', () => {
    expect(() => loadConfig({ OPENGYM_DISTRIBUTION: 'true' })).toThrow(/OPENGYM_DISTRIBUTION/)
  })

  test('keeps personal and distribution Metro caches separate', () => {
    expect(loadConfig({ ACTION: 'install' }).cacheVersion).not.toBe(loadConfig().cacheVersion)
  })
})

describe('personal builds', () => {
  test.each([
    {},
    { ACTION: 'build', CONFIGURATION: 'Debug' },
    { ACTION: 'build', CONFIGURATION: 'Release', NODE_ENV: 'production' },
    { OPENGYM_DISTRIBUTION: '0' }
  ])('retains the personal snapshot for %j', env => {
    expect(resolveSnapshot(loadConfig(env))).toEqual({ type: 'sourceFile', filePath: local })
  })

  test('falls back to the example until a personal snapshot is generated', () => {
    let exists = false
    const config = loadConfig({}, filename => {
      expect(filename).toBe(local)
      return exists
    })
    expect(resolveSnapshot(config).filePath).toBe(example)
    exists = true
    expect(resolveSnapshot(config).filePath).toBe(local)
  })

  test('leaves all unrelated module resolution to Metro', () => {
    const expected = { type: 'sourceFile', filePath: '/some/module.js' }
    const context = { resolveRequest(actualContext, name, platform) {
      expect(actualContext).toBe(context)
      expect(name).toBe('react')
      expect(platform).toBe('ios')
      return expected
    } }
    expect(loadConfig().resolver.resolveRequest(context, 'react', 'ios')).toBe(expected)
  })
})
