import { afterEach, describe, expect, test, vi } from 'vitest'
import { createMemoryWhoopCache } from './whoop-cache.js'
import { createWhoopSource, isGoodRead, isServerLink, pairingFrom, WHOOP_EVERY_MS, WHOOP_RETRY_MS } from './whoop-source.js'

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

function setup({ pairing = { base: BASE, token: TOKEN, profileId: 'u_mo' } } = {}) {
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
    expect(await cache.get()).toEqual({ server: BASE, profileId: 'u_mo', savedAt: clock.t, payload: read1 })
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

  test("a good read is held until the server's copy is 10 minutes old, not 10 minutes after the attempt", async () => {
    const { fake, clock, source } = setup()
    // The server answered from its own cache, fetched from WHOOP 4 minutes ago.
    const older = { ...read1, fetchedAt: new Date(clock.t - 4 * 60_000).toISOString() }
    fake.answer('getWhoop', ok(older), ok(read2))
    const first = await source.read()
    clock.t += 6 * 60_000 - 1
    expect(await source.read()).toBe(first)
    expect(fake.count('getWhoop')).toBe(1)
    clock.t += 1
    expect((await source.read()).payload).toEqual(read2)
    expect(fake.count('getWhoop')).toBe(2)
  })

  test('a good read is held at least a minute, and at most 10 minutes from the attempt', async () => {
    for (const [ago, heldMs] of [
      [15 * 60_000, WHOOP_RETRY_MS], // already older than 10 minutes: a minute
      [-30 * 60_000, WHOOP_EVERY_MS], // fetched "in the future" (the phone's clock behind): 10 minutes
    ]) {
      const { fake, clock, source } = setup()
      fake.answer('getWhoop', ok({ ...read1, fetchedAt: new Date(clock.t - ago).toISOString() }))
      await source.read()
      clock.t += heldMs - 1
      await source.read()
      expect(fake.count('getWhoop'), String(ago)).toBe(1)
      clock.t += 1
      await source.read()
      expect(fake.count('getWhoop'), String(ago)).toBe(2)
    }
    expect(WHOOP_RETRY_MS).toBe(60 * 1000)
  })

  test('a good read whose fetchedAt cannot be read is held 10 minutes from the attempt', async () => {
    for (const fetchedAt of [null, 'not a date', 1_000]) {
      const { fake, clock, source } = setup()
      fake.answer('getWhoop', ok({ ...read1, fetchedAt }))
      await source.read()
      clock.t += WHOOP_EVERY_MS - 1
      await source.read()
      expect(fake.count('getWhoop'), String(fetchedAt)).toBe(1)
      clock.t += 1
      await source.read()
      expect(fake.count('getWhoop'), String(fetchedAt)).toBe(2)
    }
  })

  test('not connected, or not set up, is never held: the next read asks again', async () => {
    for (const shape of [notConnected, unconfigured]) {
      const { fake, clock, source } = setup()
      fake.answer('getWhoop', ok(shape), ok(read1))
      await source.read()
      clock.t += 1000
      expect((await source.read()).payload).toEqual(read1)
      expect(fake.count('getWhoop')).toBe(2)
    }
  })

  test('a failure, WHOOP unavailable or a stale read waits a minute, then asks', async () => {
    for (const answer of [offline, { ok: false, kind: 'server', status: 503 }, ok(unavailable), ok({ ...read1, stale: true })]) {
      const { fake, clock, source } = setup()
      fake.answer('getWhoop', answer, ok(read2))
      await source.read()
      clock.t += WHOOP_RETRY_MS - 1
      await source.read()
      expect(fake.count('getWhoop')).toBe(1)
      clock.t += 1
      expect((await source.read()).payload).toEqual(read2)
      expect(fake.count('getWhoop')).toBe(2)
    }
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
    const savedAt = clock.t
    await source.read()
    for (const failure of [offline, { ok: false, kind: 'server', status: 503 }, { ok: false, kind: 'unauthorized' }, { ok: false, kind: 'refused', status: 404 }]) {
      clock.t += WHOOP_EVERY_MS
      fake.answer('getWhoop', failure)
      // savedAt rides along, for "As of" when a read has no fetchedAt.
      expect(await source.read()).toEqual({ paired: true, payload: read1, cached: true, savedAt })
    }
  })

  test("WHOOP unavailable on the server: the phone's cached read if it has one, else the server's error", async () => {
    const { fake, clock, source } = setup()
    fake.answer('getWhoop', ok(unavailable))
    expect(await source.read()).toEqual({ paired: true, payload: unavailable, cached: false })
    clock.t += WHOOP_EVERY_MS
    fake.answer('getWhoop', ok(read1))
    const savedAt = clock.t
    await source.read()
    clock.t += WHOOP_EVERY_MS
    fake.answer('getWhoop', ok(unavailable))
    expect(await source.read()).toEqual({ paired: true, payload: read1, cached: true, savedAt })
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
    state.pairing = { base: 'http://192.168.1.5:3000', token: 'T2', profileId: 'u_mo' }
    fake.answer('getWhoop', offline)
    expect(await source.read()).toEqual({ paired: true, payload: null, cached: false })
    expect(fake.calls.at(-1)).toEqual({ name: 'getWhoop', base: 'http://192.168.1.5:3000', token: 'T2' })
    state.pairing = { base: BASE, token: 'T3', profileId: 'u_ann' }
    expect(await source.read()).toEqual({ paired: true, payload: null, cached: false })
    expect(fake.count('getWhoop')).toBe(3)
  })

  test('a cache that fails to read or write never breaks the card', async () => {
    const fake = fakeClient()
    const broken = { get: async () => { throw new Error('db') }, put: async () => { throw new Error('db') }, clear: async () => { throw new Error('db') } }
    let t = 0
    const source = createWhoopSource({ client: fake.client, cache: broken, pairing: async () => ({ base: BASE, token: TOKEN, profileId: '' }), now: () => t })
    fake.answer('getWhoop', ok(read1), offline, ok(notConnected))
    expect(await source.read()).toEqual({ paired: true, payload: read1, cached: false })
    t += WHOOP_EVERY_MS
    expect(await source.read()).toEqual({ paired: true, payload: null, cached: false })
    t += WHOOP_EVERY_MS
    expect(await source.read()).toEqual({ paired: true, payload: notConnected, cached: false })
  })

  test('the cached read is offered before a first fetch, and only then', async () => {
    const { fake, cache, clock, source } = setup()
    await cache.put({ server: BASE, profileId: 'u_mo', savedAt: 1, payload: read1 })
    const early = []
    fake.answer('getWhoop', ok(read2))
    expect(await source.read({ onCached: s => early.push(s) })).toEqual({ paired: true, payload: read2, cached: false })
    expect(early).toEqual([{ paired: true, payload: read1, cached: true, savedAt: 1 }])
    clock.t += WHOOP_EVERY_MS
    await source.read({ onCached: s => early.push(s) })
    expect(early).toHaveLength(1)
  })
})

describe('the pairing', () => {
  const A = { base: BASE, token: 'TOKEN-A', profileId: 'id_a' }
  const B = { base: BASE, token: 'TOKEN-B', profileId: 'id_b' } // same server, same name, another profile

  test("Forget, then pair a same-named profile on that server: asked afresh, never the first profile's read or row", async () => {
    const { fake, clock, state, source } = setup({ pairing: A })
    fake.answer('getWhoop', ok(read1))
    await source.read()
    state.pairing = null
    expect((await source.read()).paired).toBe(false)
    state.pairing = B
    clock.t += 60_000
    fake.answer('getWhoop', offline)
    expect(await source.read()).toEqual({ paired: true, payload: null, cached: false })
    expect(fake.calls.at(-1)).toEqual({ name: 'getWhoop', base: BASE, token: 'TOKEN-B' })
  })

  test("a pairing change with nothing cached drops what was shown at once, before the new read lands", async () => {
    const { fake, clock, state, source } = setup({ pairing: A })
    fake.answer('getWhoop', ok(read1))
    await source.read()
    state.pairing = { base: 'https://other.example.com', token: 'T2', profileId: 'id_c' }
    clock.t += 1000
    let release
    fake.answer('getWhoop', () => new Promise(resolve => { release = () => resolve(ok(read2)) }))
    const early = []
    const inFlight = source.read({ onCached: s => early.push(s) })
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    expect(early).toEqual([null])
    release()
    expect((await inFlight).payload).toEqual(read2)
  })

  test("back to a pairing whose read has aged out: the other pairing's card drops at once", async () => {
    const { fake, clock, state, source } = setup({ pairing: A })
    fake.answer('getWhoop', ok(read1), ok(read2))
    await source.read()
    state.pairing = { base: 'https://other.example.com', token: 'T2', profileId: 'id_c' }
    await source.read()
    state.pairing = A
    clock.t += WHOOP_EVERY_MS
    const early = []
    let release
    fake.answer('getWhoop', () => new Promise(resolve => { release = () => resolve(ok(read1)) }))
    const inFlight = source.read({ onCached: s => early.push(s) })
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    // The one cache row is the other pairing's now, so there is nothing of A's to show yet.
    expect(early).toEqual([null])
    release()
    await inFlight
  })

  test('back to the same pairing after a Forget: its cached read, not the unpaired line, while it reads', async () => {
    const { fake, clock, state, source } = setup({ pairing: A })
    fake.answer('getWhoop', ok(read1))
    const savedAt = clock.t
    await source.read({ onCached: () => {} })
    state.pairing = null
    expect((await source.read({ onCached: () => {} })).paired).toBe(false)
    state.pairing = A
    clock.t += WHOOP_EVERY_MS
    const early = []
    fake.answer('getWhoop', offline)
    await source.read({ onCached: s => early.push(s) })
    expect(early).toEqual([{ paired: true, payload: read1, cached: true, savedAt }])
  })

  test('re-paired to the same profile inside the 10 minutes: its read again, and no blank when it next reads', async () => {
    const { fake, cache, clock, state, source } = setup({ pairing: A })
    fake.answer('getWhoop', ok(read1))
    const first = await source.read({ onCached: () => {} })
    state.pairing = null
    await source.read({ onCached: () => {} })
    state.pairing = A
    await cache.clear() // what the sync engine's pair() does
    clock.t += 1000
    expect(await source.read({ onCached: () => {} })).toBe(first)
    clock.t += WHOOP_EVERY_MS
    const early = []
    await source.read({ onCached: s => early.push(s) })
    expect(early).toEqual([])
  })

  test('the same pairing is never blanked while it reads again after 10 minutes', async () => {
    const { fake, clock, source } = setup()
    fake.answer('getWhoop', ok(notConnected)) // nothing is cached for it
    await source.read()
    clock.t += WHOOP_EVERY_MS
    const early = []
    await source.read({ onCached: s => early.push(s) })
    expect(early).toEqual([])
    expect(fake.count('getWhoop')).toBe(2)
  })

  test('a read overtaken before it saves never writes its row at all (a kill then cannot leave it)', async () => {
    for (const overtake of ['disconnect', 'forget']) {
      const fake = fakeClient()
      const memory = createMemoryWhoopCache()
      const puts = []
      const cache = { ...memory, put: row => { puts.push(row); return memory.put(row) } }
      let pairing = A
      const source = createWhoopSource({ client: fake.client, cache, pairing: async () => pairing, now: () => 0 })
      let release
      fake.answer('getWhoop', () => new Promise(resolve => { release = () => resolve(ok(read1)) }), offline)
      const inFlight = source.read()
      await vi.waitFor(() => expect(release).toBeTypeOf('function'))
      if (overtake === 'disconnect') {
        fake.answer('whoopDisconnect', { ok: true, revoked: true, wasConnected: true })
        await source.disconnect()
      } else pairing = null
      release()
      await inFlight
      expect(puts, overtake).toEqual([])
    }
  })

  test("a pairing change shows the new pairing's own cached read at once", async () => {
    const { fake, cache, clock, state, source } = setup({ pairing: A })
    fake.answer('getWhoop', ok(read1))
    await source.read()
    state.pairing = B
    await cache.put({ server: BASE, profileId: 'id_b', savedAt: 7, payload: read2 })
    clock.t += 1000
    const early = []
    fake.answer('getWhoop', offline)
    await source.read({ onCached: s => early.push(s) })
    expect(early).toEqual([{ paired: true, payload: read2, cached: true, savedAt: 7 }])
  })

  test('after a Disconnect the same pairing is not blanked while it reads again', async () => {
    const { fake, clock, source } = setup()
    fake.answer('getWhoop', ok(read1), ok(notConnected))
    await source.read({ onCached: () => {} })
    fake.answer('whoopDisconnect', { ok: true, revoked: true, wasConnected: true })
    await source.disconnect()
    clock.t += 1000
    const early = []
    expect((await source.read({ onCached: s => early.push(s) })).payload).toEqual(notConnected)
    expect(early).toEqual([])
  })

  test('a Forget while a read is out: the read says unpaired and plants no row', async () => {
    const { fake, cache, state, source } = setup({ pairing: A })
    let release
    fake.answer('getWhoop', () => new Promise(resolve => { release = () => resolve(ok(read1)) }))
    const inFlight = source.read()
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    state.pairing = null
    await cache.clear() // what the sync engine's forget() does
    release()
    expect(await inFlight).toEqual({ paired: false, payload: null, cached: false })
    expect(await cache.get()).toBeNull()
  })

  test('a Forget while the read is saving: the row it saved is taken out again', async () => {
    const fake = fakeClient()
    const memory = createMemoryWhoopCache()
    let releasePut
    const cache = { ...memory, put: row => new Promise(resolve => { releasePut = () => resolve(memory.put(row)) }) }
    let pairing = A
    const source = createWhoopSource({ client: fake.client, cache, pairing: async () => pairing, now: () => 0 })
    fake.answer('getWhoop', ok(read1))
    const inFlight = source.read()
    await vi.waitFor(() => expect(releasePut).toBeTypeOf('function'))
    pairing = null
    await memory.clear()
    releasePut()
    expect(await inFlight).toEqual({ paired: false, payload: null, cached: false })
    expect(await memory.get()).toBeNull()
  })

  test('a Disconnect that lands while the read is saving, then offline: the old numbers never come back', async () => {
    const fake = fakeClient()
    const memory = createMemoryWhoopCache()
    let releasePut
    let held = true
    const cache = { ...memory, put: row => (held ? new Promise(resolve => { releasePut = () => { held = false; resolve(memory.put(row)) } }) : memory.put(row)) }
    const source = createWhoopSource({ client: fake.client, cache, pairing: async () => A, now: () => 0 })
    fake.answer('getWhoop', ok(read1), offline)
    const inFlight = source.read()
    await vi.waitFor(() => expect(releasePut).toBeTypeOf('function'))
    fake.answer('whoopDisconnect', { ok: true, revoked: true, wasConnected: true })
    await source.disconnect()
    releasePut()
    expect(await inFlight).toEqual({ paired: true, payload: null, cached: false })
    expect(await memory.get()).toBeNull()
  })
})

describe('pairingFrom: the Keychain token and the paired server, read as one', () => {
  // sync_meta as a map, and a Keychain whose read can run code meanwhile (a pair() or forget()
  // landing between the reads, as the sync engine's exclusive block does not cover this one).
  function stores({ server = BASE, profileId = 'u_mo', token = 'TOKEN-A' } = {}) {
    const rows = new Map(Object.entries({ server, profileId }).filter(([, v]) => v != null))
    const meta = { get: async k => rows.get(k) ?? null }
    const keychain = { token, during: [] }
    const credentials = {
      get: async () => {
        const held = keychain.token
        keychain.during.shift()?.(rows, keychain)
        return held ? { token: held } : null
      },
    }
    return { rows, keychain, pairing: pairingFrom({ credentials, meta }) }
  }
  // What pair() does, in its order: the old token goes, the address and id change, the new token comes.
  const repair = (base, profileId, token) => (rows, keychain) => {
    keychain.token = null
    rows.set('server', base)
    rows.set('profileId', profileId)
    keychain.token = token
  }

  test('paired: the server, the token and the profile id', async () => {
    expect(await stores().pairing()).toEqual({ base: BASE, token: 'TOKEN-A', profileId: 'u_mo' })
  })

  test('no token, or no server, is unpaired; a pairing from before profile ids keys on ""', async () => {
    expect(await stores({ token: null }).pairing()).toBeNull()
    expect(await stores({ server: null }).pairing()).toBeNull()
    expect(await stores({ profileId: null }).pairing()).toEqual({ base: BASE, token: 'TOKEN-A', profileId: '' })
  })

  test("a pairing that moves to another server during the Keychain read never pairs one's token with the other's address", async () => {
    const { keychain, pairing } = stores()
    keychain.during.push(repair('https://other.example.com', 'u_mo', 'TOKEN-B'))
    expect(await pairing()).toEqual({ base: 'https://other.example.com', token: 'TOKEN-B', profileId: 'u_mo' })
  })

  test('a pairing that moves to another profile on the same server during the read is read again too', async () => {
    const { keychain, pairing } = stores()
    keychain.during.push(repair(BASE, 'u_ann', 'TOKEN-C'))
    expect(await pairing()).toEqual({ base: BASE, token: 'TOKEN-C', profileId: 'u_ann' })
  })

  test('a pairing still moving on the second read counts as unpaired for now', async () => {
    const { keychain, pairing } = stores()
    keychain.during.push(repair('https://other.example.com', 'u_mo', 'TOKEN-B'), repair('https://third.example.com', 'u_mo', 'TOKEN-D'))
    expect(await pairing()).toBeNull()
  })
})

describe('isGoodRead: a fresh answer from the server, which clears a failure message', () => {
  test.each([
    ['a connected read', { paired: true, payload: read1, cached: false }, true],
    ['not connected', { paired: true, payload: notConnected, cached: false }, true],
    ['not set up', { paired: true, payload: unconfigured, cached: false }, true],
    ['a stale read the server still answered with', { paired: true, payload: { ...read1, stale: true }, cached: false }, true],
    ["the phone's cached read", { paired: true, payload: read1, cached: true, savedAt: 1 }, false],
    ['WHOOP unavailable', { paired: true, payload: unavailable, cached: false }, false],
    ['the server not reached', { paired: true, payload: null, cached: false }, false],
    ['unpaired', { paired: false, payload: null, cached: false }, false],
    ['nothing yet', null, false],
  ])('%s: %s', (_n, shown, want) => {
    expect(isGoodRead(shown)).toBe(want)
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

  test('the Connect window lasts as long as the link, then the usual wait applies again', async () => {
    const { fake, clock, source } = setup()
    fake.answer('whoopConnectLink', { ok: true, url: `${BASE}/api/whoop/connect?c=abc` })
    await source.connectLink()
    const at = clock.t
    fake.answer('getWhoop', offline) // each failure would wait a minute, but for the window
    clock.t = at + 1000
    await source.read()
    clock.t = at + 2000
    await source.read()
    clock.t = at + WHOOP_EVERY_MS - 1
    await source.read()
    expect(fake.count('getWhoop')).toBe(3)
    clock.t = at + WHOOP_EVERY_MS
    await source.read()
    expect(fake.count('getWhoop')).toBe(3)
  })

  test('a disconnect ends the Connect window', async () => {
    const { fake, clock, source } = setup()
    fake.answer('whoopConnectLink', { ok: true, url: `${BASE}/api/whoop/connect?c=abc` })
    await source.connectLink()
    fake.answer('whoopDisconnect', { ok: true, revoked: false, wasConnected: false })
    await source.disconnect()
    fake.answer('getWhoop', offline)
    clock.t += 1000
    await source.read()
    clock.t += 1000
    await source.read()
    expect(fake.count('getWhoop')).toBe(1)
  })

  test('a link to anywhere but the paired server is refused, naming the host it is on', async () => {
    const { fake, clock, source } = setup()
    fake.answer('getWhoop', offline)
    await source.read()
    for (const [url, elsewhere] of [
      ['https://evil.example.com/api/whoop/connect?c=abc', 'evil.example.com'],
      ['https://Gym.Example.org:443/api/whoop/connect?c=abc', 'gym.example.org'],
      ['http://localhost:8080/api/whoop/connect?c=abc', 'localhost:8080'],
      ['https://gym.example.com:8443/api/whoop/connect?c=abc', 'gym.example.com:8443'],
      // Only the scheme differs: the host alone would name the address it is already paired at.
      ['http://gym.example.com/api/whoop/connect?c=abc', 'http://gym.example.com'],
      ['HTTP://Gym.Example.com:80/api/whoop/connect?c=abc', 'http://gym.example.com'],
    ]) {
      fake.answer('whoopConnectLink', { ok: true, url })
      expect(await source.connectLink()).toEqual({ ok: false, elsewhere })
    }
    // Nothing was opened, so no Connect window: the minute's wait after a failure still applies.
    clock.t += 1000
    await source.read()
    expect(fake.count('getWhoop')).toBe(1)
  })

  test('a link that is not an http(s) address is a plain failure, with no host named', async () => {
    const { fake, source } = setup()
    for (const url of ['javascript:alert(1)', 'opengym://whoop', 'https://gym.example.com/x y', 'https://evil.example.com/x\n']) {
      fake.answer('whoopConnectLink', { ok: true, url })
      expect(await source.connectLink()).toEqual({ ok: false })
    }
  })

  test('not set up on the server says so, and the next read asks at once', async () => {
    const { fake, clock, source } = setup()
    fake.answer('getWhoop', offline, ok(unconfigured))
    await source.read() // a failure: it would wait a minute
    fake.answer('whoopConnectLink', { ok: false, kind: 'unconfigured' })
    expect(await source.connectLink()).toEqual({ ok: false, unconfigured: true })
    clock.t += 1000
    expect((await source.read()).payload).toEqual(unconfigured)
    expect(fake.count('getWhoop')).toBe(2)
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
    const source = createWhoopSource({ client: fake.client, cache, pairing: async () => ({ base: BASE, token: TOKEN, profileId: '' }), now: () => t })
    fake.answer('getWhoop', ok(read1), ok(notConnected))
    const inFlight = source.read()
    await vi.waitFor(() => expect(releasePut).toBeTypeOf('function'))
    fake.answer('whoopDisconnect', { ok: true, revoked: true, wasConnected: true })
    await source.disconnect()
    releasePut()
    expect(await inFlight).toEqual({ paired: true, payload: notConnected, cached: false })
    expect(fake.count('getWhoop')).toBe(2)
    t += 1000
    // Not connected is never held, so it asks again, and still no read1 comes back.
    expect(await source.read()).toEqual({ paired: true, payload: notConnected, cached: false })
    expect(fake.count('getWhoop')).toBe(3)
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
