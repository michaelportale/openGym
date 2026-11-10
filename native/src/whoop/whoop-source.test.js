import { afterEach, describe, expect, test, vi } from 'vitest'
import { createMemoryWhoopCache } from './whoop-cache.js'
import { createWhoopSource, isServerLink, WHOOP_EVERY_MS } from './whoop-source.js'

const BASE = 'https://gym.example.com'
const TOKEN = 'SECRET.TOKEN.VALUE'
const read1 = { configured: true, connected: true, fetchedAt: '2026-11-09T12:00:00.000Z', stale: false, days: [{ d: '2026-11-09', recovery: 67, hrv: 55, rhr: 52, calibrating: false, strain: 12 }], workouts: [] }
const read2 = { ...read1, fetchedAt: '2026-11-09T12:10:00.000Z', days: [{ ...read1.days[0], recovery: 70 }] }
const notConnected = { configured: true, connected: false, fetchedAt: null, stale: false, days: [], workouts: [] }
const unconfigured = { configured: false, connected: false, fetchedAt: null, stale: false, days: [], workouts: [] }
const unavailable = { configured: true, connected: true, fetchedAt: null, stale: false, days: [], workouts: [], error: 'unavailable' }

// A client whose answers are queued per call; an empty queue repeats the last answer.
function fakeClient() {
  const calls = []
  const queues = { getWhoop: [], whoopConnectLink: [], whoopDisconnect: [] }
  const lastOf = {}
  const answer = name => async (base, token) => {
    calls.push({ name, base, token })
    const next = queues[name].length ? queues[name].shift() : lastOf[name]
    lastOf[name] = next
    return typeof next === 'function' ? next() : next
  }
  return {
    calls,
    count: name => calls.filter(c => c.name === name).length,
    answer(name, ...results) { queues[name].push(...results) },
    client: { getWhoop: answer('getWhoop'), whoopConnectLink: answer('whoopConnectLink'), whoopDisconnect: answer('whoopDisconnect') },
  }
}

function setup({ pairing = { base: BASE, token: TOKEN, profile: 'Mo' } } = {}) {
  const fake = fakeClient()
  const cache = createMemoryWhoopCache()
  const clock = { t: Date.UTC(2026, 10, 9, 12) }
  const state = { pairing }
  const source = createWhoopSource({ client: fake.client, cache, pairing: async () => state.pairing, now: () => clock.t })
  return { fake, cache, clock, state, source }
}

const ok = whoop => ({ ok: true, whoop })
const offline = { ok: false, kind: 'offline' }

afterEach(() => vi.restoreAllMocks())

describe('read', () => {
  test('unpaired: nothing is asked of the server', async () => {
    const { fake, source } = setup({ pairing: null })
    expect(await source.read()).toEqual({ paired: false, payload: null, cached: false })
    expect(fake.calls).toEqual([])
  })

  test('a pairing that cannot be read counts as unpaired', async () => {
    const fake = fakeClient()
    const source = createWhoopSource({ client: fake.client, cache: createMemoryWhoopCache(), pairing: async () => { throw new Error('keychain') }, now: () => 1 })
    expect(await source.read()).toEqual({ paired: false, payload: null, cached: false })
    expect(fake.calls).toEqual([])
  })

  test('paired: asks with the base and token, keeps the good read in the cache', async () => {
    const { fake, cache, clock, source } = setup()
    fake.answer('getWhoop', ok(read1))
    expect(await source.read()).toEqual({ paired: true, payload: read1, cached: false })
    expect(fake.calls).toEqual([{ name: 'getWhoop', base: BASE, token: TOKEN }])
    expect(await cache.get()).toEqual({ server: BASE, profile: 'Mo', savedAt: clock.t, payload: read1 })
  })

  test('at most every 10 minutes: a read inside the window answers from memory, the same object', async () => {
    const { fake, clock, source } = setup()
    fake.answer('getWhoop', ok(read1), ok(read2))
    const first = await source.read()
    clock.t += WHOOP_EVERY_MS - 1
    expect(await source.read()).toBe(first)
    expect(fake.count('getWhoop')).toBe(1)
    clock.t += 1
    expect((await source.read()).payload).toEqual(read2)
    expect(fake.count('getWhoop')).toBe(2)
    expect(WHOOP_EVERY_MS).toBe(10 * 60 * 1000)
  })

  test('a failed attempt also waits out the window', async () => {
    const { fake, clock, source } = setup()
    fake.answer('getWhoop', offline, ok(read1))
    await source.read()
    clock.t += 60_000
    await source.read()
    expect(fake.count('getWhoop')).toBe(1)
  })

  test('a clock set back does not stall the card for the difference', async () => {
    const { fake, clock, source } = setup()
    fake.answer('getWhoop', ok(read1))
    await source.read()
    clock.t -= 60 * 60_000
    await source.read()
    expect(fake.count('getWhoop')).toBe(2)
  })

  test('offline or on a server error: the cached read, marked cached; nothing cached gives no payload', async () => {
    const { fake, clock, source } = setup()
    fake.answer('getWhoop', offline)
    expect(await source.read()).toEqual({ paired: true, payload: null, cached: false })
    clock.t += WHOOP_EVERY_MS
    fake.answer('getWhoop', ok(read1))
    await source.read()
    for (const failure of [offline, { ok: false, kind: 'server', status: 503 }, { ok: false, kind: 'unauthorized' }, { ok: false, kind: 'refused', status: 404 }]) {
      clock.t += WHOOP_EVERY_MS
      fake.answer('getWhoop', failure)
      expect(await source.read()).toEqual({ paired: true, payload: read1, cached: true })
    }
  })

  test("WHOOP unavailable on the server: the phone's cached read if it has one, else the server's error", async () => {
    const { fake, clock, source } = setup()
    fake.answer('getWhoop', ok(unavailable))
    expect(await source.read()).toEqual({ paired: true, payload: unavailable, cached: false })
    clock.t += WHOOP_EVERY_MS
    fake.answer('getWhoop', ok(read1))
    await source.read()
    clock.t += WHOOP_EVERY_MS
    fake.answer('getWhoop', ok(unavailable))
    expect(await source.read()).toEqual({ paired: true, payload: read1, cached: true })
  })

  test("a stale read from the server is shown as sent, and kept", async () => {
    const { fake, cache, source } = setup()
    const stale = { ...read1, stale: true }
    fake.answer('getWhoop', ok(stale))
    expect(await source.read()).toEqual({ paired: true, payload: stale, cached: false })
    expect((await cache.get()).payload).toEqual(stale)
  })

  test('not connected, or not set up, clears the cache so offline cannot bring old numbers back', async () => {
    for (const shape of [notConnected, unconfigured]) {
      const { fake, cache, clock, source } = setup()
      fake.answer('getWhoop', ok(read1), ok(shape), offline)
      await source.read()
      clock.t += WHOOP_EVERY_MS
      expect(await source.read()).toEqual({ paired: true, payload: shape, cached: false })
      expect(await cache.get()).toBeNull()
      clock.t += WHOOP_EVERY_MS
      expect(await source.read()).toEqual({ paired: true, payload: null, cached: false })
    }
  })

  test("another server or profile: asked at once, and the old pairing's cache is never shown", async () => {
    const { fake, clock, state, source } = setup()
    fake.answer('getWhoop', ok(read1))
    await source.read()
    clock.t += 1000
    state.pairing = { base: 'http://192.168.1.5:3000', token: 'T2', profile: 'Mo' }
    fake.answer('getWhoop', offline)
    expect(await source.read()).toEqual({ paired: true, payload: null, cached: false })
    expect(fake.calls.at(-1)).toEqual({ name: 'getWhoop', base: 'http://192.168.1.5:3000', token: 'T2' })
    state.pairing = { base: BASE, token: 'T3', profile: 'Ann' }
    expect(await source.read()).toEqual({ paired: true, payload: null, cached: false })
    expect(fake.count('getWhoop')).toBe(3)
  })

  test('a cache that fails to read or write never breaks the card', async () => {
    const fake = fakeClient()
    const broken = { get: async () => { throw new Error('db') }, put: async () => { throw new Error('db') }, clear: async () => { throw new Error('db') } }
    let t = 0
    const source = createWhoopSource({ client: fake.client, cache: broken, pairing: async () => ({ base: BASE, token: TOKEN, profile: '' }), now: () => t })
    fake.answer('getWhoop', ok(read1), offline, ok(notConnected))
    expect(await source.read()).toEqual({ paired: true, payload: read1, cached: false })
    t += WHOOP_EVERY_MS
    expect(await source.read()).toEqual({ paired: true, payload: null, cached: false })
    t += WHOOP_EVERY_MS
    expect(await source.read()).toEqual({ paired: true, payload: notConnected, cached: false })
  })

  test('the cached read is offered before a first fetch, and only then', async () => {
    const { fake, cache, clock, source } = setup()
    await cache.put({ server: BASE, profile: 'Mo', savedAt: 1, payload: read1 })
    const early = []
    fake.answer('getWhoop', ok(read2))
    expect(await source.read({ onCached: s => early.push(s) })).toEqual({ paired: true, payload: read2, cached: false })
    expect(early).toEqual([{ paired: true, payload: read1, cached: true }])
    clock.t += WHOOP_EVERY_MS
    await source.read({ onCached: s => early.push(s) })
    expect(early).toHaveLength(1)
  })
})

describe('connect', () => {
  test('gets the link with the bearer, checks it is on the server, and the next read asks at once', async () => {
    const { fake, clock, source } = setup()
    fake.answer('getWhoop', ok(notConnected), ok(read1))
    await source.read()
    fake.answer('whoopConnectLink', { ok: true, url: `${BASE}/api/whoop/connect?c=abc` })
    expect(await source.connectLink()).toEqual({ ok: true, url: `${BASE}/api/whoop/connect?c=abc` })
    expect(fake.calls.at(-1)).toEqual({ name: 'whoopConnectLink', base: BASE, token: TOKEN })
    clock.t += 1000
    expect((await source.read()).payload).toEqual(read1)
    clock.t += 1000
    await source.read()
    expect(fake.count('getWhoop')).toBe(2)
  })

  test('after Connect, every read asks until one comes back connected (a read while Safari opens does not spend it)', async () => {
    const { fake, clock, source } = setup()
    fake.answer('getWhoop', ok(notConnected))
    await source.read()
    fake.answer('whoopConnectLink', { ok: true, url: `${BASE}/api/whoop/connect?c=abc` })
    await source.connectLink()
    fake.answer('getWhoop', ok(notConnected), ok(notConnected), ok(read1))
    clock.t += 1000
    expect((await source.read()).payload).toEqual(notConnected) // a sync emit as the app leaves
    clock.t += 60_000
    expect((await source.read()).payload).toEqual(notConnected) // still signing in
    clock.t += 60_000
    expect((await source.read()).payload).toEqual(read1) // back from Safari
    clock.t += 1000
    await source.read()
    expect(fake.count('getWhoop')).toBe(4)
  })

  test('the Connect window lasts as long as the link, then the 10 minutes apply again', async () => {
    const { fake, clock, source } = setup()
    fake.answer('whoopConnectLink', { ok: true, url: `${BASE}/api/whoop/connect?c=abc` })
    await source.connectLink()
    const at = clock.t
    fake.answer('getWhoop', ok(notConnected))
    clock.t = at + 1000
    await source.read()
    clock.t = at + WHOOP_EVERY_MS - 1
    await source.read()
    expect(fake.count('getWhoop')).toBe(2)
    clock.t = at + WHOOP_EVERY_MS
    await source.read()
    expect(fake.count('getWhoop')).toBe(2)
  })

  test('a disconnect ends the Connect window', async () => {
    const { fake, clock, source } = setup()
    fake.answer('whoopConnectLink', { ok: true, url: `${BASE}/api/whoop/connect?c=abc` })
    await source.connectLink()
    fake.answer('whoopDisconnect', { ok: true, revoked: false, wasConnected: false })
    await source.disconnect()
    fake.answer('getWhoop', ok(notConnected))
    clock.t += 1000
    await source.read()
    clock.t += 1000
    await source.read()
    expect(fake.count('getWhoop')).toBe(1)
  })

  test('a link to anywhere but the paired server is refused', async () => {
    const { fake, source } = setup()
    fake.answer('whoopConnectLink', { ok: true, url: 'https://evil.example.com/api/whoop/connect?c=abc' })
    expect(await source.connectLink()).toEqual({ ok: false })
  })

  test('not set up on the server says so, and the next read asks at once', async () => {
    const { fake, clock, source } = setup()
    fake.answer('getWhoop', ok(notConnected), ok(unconfigured))
    await source.read()
    fake.answer('whoopConnectLink', { ok: false, kind: 'unconfigured' })
    expect(await source.connectLink()).toEqual({ ok: false, unconfigured: true })
    clock.t += 1000
    expect((await source.read()).payload).toEqual(unconfigured)
  })

  test('offline, or unpaired, is a plain failure', async () => {
    const { fake, source } = setup()
    fake.answer('whoopConnectLink', offline)
    expect(await source.connectLink()).toEqual({ ok: false })
    const unpaired = setup({ pairing: null })
    expect(await unpaired.source.connectLink()).toEqual({ ok: false })
    expect(unpaired.fake.calls).toEqual([])
  })
})

describe('disconnect', () => {
  test('posts with the bearer, clears the cache, and the next read asks at once', async () => {
    const { fake, cache, clock, source } = setup()
    fake.answer('getWhoop', ok(read1), ok(notConnected))
    await source.read()
    fake.answer('whoopDisconnect', { ok: true, revoked: true, wasConnected: true })
    expect(await source.disconnect()).toEqual({ ok: true, revoked: true, wasConnected: true })
    expect(fake.calls.at(-1)).toEqual({ name: 'whoopDisconnect', base: BASE, token: TOKEN })
    expect(await cache.get()).toBeNull()
    clock.t += 1000
    expect(await source.read()).toEqual({ paired: true, payload: notConnected, cached: false })
  })

  test('says when WHOOP could not be told', async () => {
    const { fake, source } = setup()
    fake.answer('whoopDisconnect', { ok: true, revoked: false, wasConnected: true })
    expect(await source.disconnect()).toEqual({ ok: true, revoked: false, wasConnected: true })
  })

  test('a failed disconnect keeps the cache and the window', async () => {
    const { fake, cache, clock, source } = setup()
    fake.answer('getWhoop', ok(read1))
    await source.read()
    fake.answer('whoopDisconnect', offline)
    expect(await source.disconnect()).toEqual({ ok: false })
    expect((await cache.get()).payload).toEqual(read1)
    clock.t += 1000
    await source.read()
    expect(fake.count('getWhoop')).toBe(1)
  })

  test('a read still out across a disconnect never plants its numbers, even when the next one fails', async () => {
    const { fake, cache, source } = setup()
    let release
    fake.answer('getWhoop', () => new Promise(resolve => { release = () => resolve(ok(read1)) }), offline)
    const inFlight = source.read()
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    fake.answer('whoopDisconnect', { ok: true, revoked: true, wasConnected: true })
    await source.disconnect()
    release()
    // It asks again; offline, there is no cached read to fall back on.
    expect(await inFlight).toEqual({ paired: true, payload: null, cached: false })
    expect(await cache.get()).toBeNull()
    expect(fake.count('getWhoop')).toBe(2)
  })

  test('a disconnect that lands while a read is saving is not undone by that read', async () => {
    const fake = fakeClient()
    const memory = createMemoryWhoopCache()
    let releasePut
    const cache = { ...memory, put: row => new Promise(resolve => { releasePut = () => resolve(memory.put(row)) }) }
    let t = 0
    const source = createWhoopSource({ client: fake.client, cache, pairing: async () => ({ base: BASE, token: TOKEN, profile: '' }), now: () => t })
    fake.answer('getWhoop', ok(read1), ok(notConnected))
    const inFlight = source.read()
    await vi.waitFor(() => expect(releasePut).toBeTypeOf('function'))
    fake.answer('whoopDisconnect', { ok: true, revoked: true, wasConnected: true })
    await source.disconnect()
    releasePut()
    expect(await inFlight).toEqual({ paired: true, payload: notConnected, cached: false })
    t += 1000
    expect(await source.read()).toEqual({ paired: true, payload: notConnected, cached: false })
    expect(fake.count('getWhoop')).toBe(2)
  })

  test('a read still out across a disconnect that answers not connected shows that', async () => {
    const { fake, cache, source } = setup()
    let release
    fake.answer('getWhoop', () => new Promise(resolve => { release = () => resolve(ok(read1)) }), ok(notConnected))
    const inFlight = source.read()
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    fake.answer('whoopDisconnect', { ok: true, revoked: true, wasConnected: true })
    await source.disconnect()
    release()
    expect(await inFlight).toEqual({ paired: true, payload: notConnected, cached: false })
    expect(await cache.get()).toBeNull()
  })
})

test('nothing is ever logged: no payload, no link, no token', async () => {
  const spies = ['log', 'info', 'warn', 'error', 'debug'].map(m => vi.spyOn(console, m).mockImplementation(() => {}))
  const { fake, clock, source } = setup()
  fake.answer('getWhoop', ok(read1), offline, ok(unavailable), ok(notConnected))
  for (let i = 0; i < 4; i++) {
    await source.read()
    clock.t += WHOOP_EVERY_MS
  }
  fake.answer('whoopConnectLink', { ok: true, url: `${BASE}/api/whoop/connect?c=abc` }, { ok: true, url: 'https://evil.example.com/x' })
  await source.connectLink()
  await source.connectLink()
  fake.answer('whoopDisconnect', { ok: true, revoked: false, wasConnected: true }, offline)
  await source.disconnect()
  await source.disconnect()
  for (const spy of spies) expect(spy).not.toHaveBeenCalled()
})

describe('isServerLink: only http(s) on the paired server origin', () => {
  test.each([
    ['https://gym.example.com/api/whoop/connect?c=abc', 'https://gym.example.com'],
    ['https://GYM.Example.com/api/whoop/connect?c=abc', 'https://gym.example.com'],
    ['HTTPS://gym.example.com/x', 'https://gym.example.com'],
    ['https://gym.example.com:443/x', 'https://gym.example.com'],
    ['https://gym.example.com/x', 'https://gym.example.com:443'],
    ['http://192.168.1.5:3000/api/whoop/connect?c=abc', 'http://192.168.1.5:3000'],
    ['http://mac.local/x', 'http://mac.local:80'],
    ['http://[fd00::1]:3000/x', 'http://[fd00::1]:3000'],
    ['https://gym.example.com?c=abc', 'https://gym.example.com'],
  ])('%s on %s is allowed', (url, base) => {
    expect(isServerLink(url, base)).toBe(true)
  })

  test.each([
    ['https://evil.example.com/api/whoop/connect?c=abc', 'https://gym.example.com'],
    ['https://gym.example.com.evil.example/x', 'https://gym.example.com'],
    ['https://evil.example/gym.example.com', 'https://gym.example.com'],
    ['https://gym.example.com@evil.example/x', 'https://gym.example.com'],
    ['https://user@gym.example.com/x', 'https://gym.example.com'],
    ['https://gym.example.com\\@evil.example/x', 'https://gym.example.com'],
    ['http://gym.example.com/x', 'https://gym.example.com'],
    ['https://192.168.1.5:3000/x', 'http://192.168.1.5:3000'],
    ['http://192.168.1.5:3001/x', 'http://192.168.1.5:3000'],
    ['http://192.168.1.5/x', 'http://192.168.1.5:3000'],
    ['javascript:alert(1)', 'https://gym.example.com'],
    ['opengym://whoop', 'https://gym.example.com'],
    ['//gym.example.com/x', 'https://gym.example.com'],
    ['https:///gym.example.com/x', 'https://gym.example.com'],
    ['https://gym.example.com/x\n', 'https://gym.example.com'],
    [' https://gym.example.com/x', 'https://gym.example.com'],
    ['https://gym.example.com/x y', 'https://gym.example.com'],
    ['', 'https://gym.example.com'],
    [null, 'https://gym.example.com'],
    [{ toString: () => 'https://gym.example.com/' }, 'https://gym.example.com'],
    ['https://gym.example.com/x', null],
    ['https://gym.example.com/x', ''],
  ])('%s on %s is refused', (url, base) => {
    expect(isServerLink(url, base)).toBe(false)
  })
})
