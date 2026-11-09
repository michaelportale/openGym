import { describe, expect, test } from 'vitest'
import { createCredentials, TOKEN_KEY } from './credentials.js'

const fakeStore = () => {
  const m = new Map()
  const calls = []
  return {
    calls, m,
    AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'afterFirstUnlockThisDeviceOnly',
    getItemAsync: async (k, o) => { calls.push(['get', k, o]); return m.has(k) ? m.get(k) : null },
    setItemAsync: async (k, v, o) => { calls.push(['set', k, o]); m.set(k, v) },
    deleteItemAsync: async (k, o) => { calls.push(['delete', k, o]); m.delete(k) },
  }
}

describe('credentials', () => {
  test('nothing stored reads as null', async () => {
    expect(await createCredentials(fakeStore()).get()).toBeNull()
  })

  test('set then get round-trips the token under opengym.token', async () => {
    const s = fakeStore()
    const c = createCredentials(s)
    await c.set({ token: 'abc.def' })
    expect(TOKEN_KEY).toBe('opengym.token')
    expect(s.m.get('opengym.token')).toBe('abc.def')
    expect(await c.get()).toEqual({ token: 'abc.def' })
  })

  test('every call asks for after-first-unlock, this device only', async () => {
    const s = fakeStore()
    const c = createCredentials(s)
    await c.set({ token: 't' }); await c.get(); await c.clear()
    expect(s.calls).toHaveLength(3)
    for (const [, , o] of s.calls) expect(o).toEqual({ keychainAccessible: 'afterFirstUnlockThisDeviceOnly' })
  })

  test('clear removes it', async () => {
    const c = createCredentials(fakeStore())
    await c.set({ token: 't' }); await c.clear()
    expect(await c.get()).toBeNull()
  })

  test('an empty or non-string token is refused, not stored', async () => {
    const s = fakeStore()
    const c = createCredentials(s)
    await expect(c.set({ token: '' })).rejects.toThrow()
    await expect(c.set({})).rejects.toThrow()
    expect(s.m.size).toBe(0)
  })

  test('an empty stored value reads as null', async () => {
    const s = fakeStore(); s.m.set('opengym.token', '')
    expect(await createCredentials(s).get()).toBeNull()
  })

  test('a failing keychain read reads as null rather than throwing', async () => {
    const s = fakeStore(); s.getItemAsync = async () => { throw new Error('locked') }
    expect(await createCredentials(s).get()).toBeNull()
  })
})
