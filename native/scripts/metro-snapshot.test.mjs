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

describe('example snapshots', () => {
  test.each([
    {},
    { NODE_ENV: 'production' },
    { ACTION: 'build', CONFIGURATION: 'Debug' },
    { ACTION: 'build', CONFIGURATION: 'Release', NODE_ENV: 'production' },
    { OPENGYM_DISTRIBUTION: '0' },
    { OPENGYM_PERSONAL_SNAPSHOT: '0' },
    { ACTION: 'install', OPENGYM_PERSONAL_SNAPSHOT: '1', OPENGYM_DISTRIBUTION: '0' },
    { ACTION: 'archive', OPENGYM_PERSONAL_SNAPSHOT: '1' },
    { OPENGYM_DISTRIBUTION: '1', OPENGYM_PERSONAL_SNAPSHOT: '1' }
  ])('uses the example without checking for a personal snapshot for %j', env => {
    const config = loadConfig(env, () => { throw new Error('Private file checked') })
    expect(resolveSnapshot(config)).toEqual({ type: 'sourceFile', filePath: example })
  })

  test.each([
    { OPENGYM_DISTRIBUTION: 'true' },
    { OPENGYM_DISTRIBUTION: '' },
    { OPENGYM_PERSONAL_SNAPSHOT: 'true' },
    { OPENGYM_PERSONAL_SNAPSHOT: '' }
  ])('rejects invalid snapshot flags for %j', env => {
    expect(() => loadConfig(env)).toThrow(Object.keys(env)[0])
  })

  test('uses separate Metro caches for example and personal modes', () => {
    const exampleCache = loadConfig().cacheVersion
    expect(loadConfig({ OPENGYM_PERSONAL_SNAPSHOT: '1' }).cacheVersion).not.toBe(exampleCache)
    expect(loadConfig({ ACTION: 'install', OPENGYM_PERSONAL_SNAPSHOT: '1' }).cacheVersion).toBe(exampleCache)
    expect(loadConfig({ OPENGYM_DISTRIBUTION: '1', OPENGYM_PERSONAL_SNAPSHOT: '1' }).cacheVersion).toBe(exampleCache)
  })
})

describe('personal builds', () => {
  test.each([
    { OPENGYM_PERSONAL_SNAPSHOT: '1' },
    { ACTION: 'build', CONFIGURATION: 'Debug', OPENGYM_PERSONAL_SNAPSHOT: '1' },
    { ACTION: 'build', CONFIGURATION: 'Release', NODE_ENV: 'production', OPENGYM_PERSONAL_SNAPSHOT: '1' }
  ])('uses the personal snapshot when explicitly enabled for %j', env => {
    expect(resolveSnapshot(loadConfig(env))).toEqual({ type: 'sourceFile', filePath: local })
  })

  test('falls back to the example until a personal snapshot is generated', () => {
    let exists = false
    const config = loadConfig({ OPENGYM_PERSONAL_SNAPSHOT: '1' }, filename => {
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
