import { describe, expect, test, vi } from 'vitest'
import { createApiClient } from './api-client.js'

const BASE = 'https://gym.example.com'
const TOKEN = 'SECRET.TOKEN.VALUE'

const res = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => { if (body === undefined) throw new Error('no body'); return body } })
const make = (handler, opts = {}) => {
  const calls = []
  const fetch = async (url, init) => { calls.push({ url, init }); return handler(url, init) }
  return { calls, client: createApiClient({ fetch, ...opts }) }
}

describe('redeem', () => {
  test('200 gives the token and user, sent as a JSON body without auth', async () => {
    const { client, calls } = make(() => res(200, { token: 'T', user: { id: 'u', name: 'Mo', admin: false } }))
    const r = await client.redeem(BASE, 'ABC123')
    expect(r).toEqual({ ok: true, token: 'T', user: { id: 'u', name: 'Mo', admin: false } })
    expect(calls[0].url).toBe(`${BASE}/api/pair/redeem`)
    expect(calls[0].init.method).toBe('POST')
    expect(JSON.parse(calls[0].init.body)).toEqual({ code: 'ABC123' })
    expect(calls[0].init.headers.Authorization).toBeUndefined()
  })
  test('400 pair-invalid is invalid-code', async () => {
    const { client } = make(() => res(400, { error: 'x', code: 'pair-invalid' }))
    expect(await client.redeem(BASE, 'X')).toEqual({ ok: false, kind: 'invalid-code' })
  })
  test('other 400 is refused, with its status', async () => {
    const { client } = make(() => res(400, { error: 'x' }))
    expect(await client.redeem(BASE, 'X')).toEqual({ ok: false, kind: 'refused', status: 400 })
  })
  test('200 without a token is a server error', async () => {
    const { client } = make(() => res(200, { user: {} }))
    expect((await client.redeem(BASE, 'X')).kind).toBe('server')
  })
})

describe('me', () => {
  test('sends the Bearer token and returns the user', async () => {
    const { client, calls } = make(() => res(200, { user: { id: 'u' } }))
    expect(await client.me(BASE, TOKEN)).toEqual({ ok: true, user: { id: 'u' } })
    expect(calls[0].url).toBe(`${BASE}/api/me`)
    expect(calls[0].init.headers.Authorization).toBe(`Bearer ${TOKEN}`)
  })
  test('surfaces a renewed token', async () => {
    const { client } = make(() => res(200, { user: { id: 'u' }, token: 'NEW' }))
    expect(await client.me(BASE, TOKEN)).toEqual({ ok: true, user: { id: 'u' }, token: 'NEW' })
  })
  test('401 is unauthorized', async () => {
    const { client } = make(() => res(401, { error: 'not signed in' }))
    expect(await client.me(BASE, TOKEN)).toEqual({ ok: false, kind: 'unauthorized' })
  })
})

describe('rev and pull', () => {
  test('rev returns rev and wid', async () => {
    const { client, calls } = make(() => res(200, { rev: 7, wid: 'w1' }))
    expect(await client.rev(BASE, TOKEN)).toEqual({ ok: true, rev: 7, wid: 'w1' })
    expect(calls[0].url).toBe(`${BASE}/api/data/rev`)
  })
  test('rev without wid', async () => {
    const { client } = make(() => res(200, { rev: 0 }))
    expect(await client.rev(BASE, TOKEN)).toEqual({ ok: true, rev: 0, wid: undefined })
  })
  test('pull returns state and rev', async () => {
    const { client, calls } = make(() => res(200, { state: { workouts: [], _wid: 'a' }, rev: 3 }))
    expect(await client.pull(BASE, TOKEN)).toEqual({ ok: true, state: { workouts: [], _wid: 'a' }, rev: 3 })
    expect(calls[0].url).toBe(`${BASE}/api/data`)
    expect(calls[0].init.method).toBe('GET')
  })
  test('pull 503 is server', async () => {
    const { client } = make(() => res(503, { error: 'state unreadable' }))
    expect(await client.pull(BASE, TOKEN)).toEqual({ ok: false, kind: 'server', status: 503 })
  })
  test('rev 401 is unauthorized', async () => {
    const { client } = make(() => res(401, {}))
    expect((await client.rev(BASE, TOKEN)).kind).toBe('unauthorized')
  })
  test('a profile with no document yet pulls as an empty document at rev 0', async () => {
    const { client } = make(() => res(200, { state: null, rev: 0 }))
    expect(await client.pull(BASE, TOKEN)).toEqual({ ok: true, state: {}, rev: 0 })
  })
  test('a state that is neither an object nor null is still a server error', async () => {
    expect((await make(() => res(200, { state: 'x', rev: 0 })).client.pull(BASE, TOKEN)).kind).toBe('server')
    expect((await make(() => res(200, { state: [], rev: 0 })).client.pull(BASE, TOKEN)).kind).toBe('server')
  })
})

describe('a 4xx the server means', () => {
  test.each([400, 403, 404, 405, 410, 422])('%i is refused with its status, on every call', async status => {
    const { client } = make(() => res(status, { error: 'no' }))
    expect(await client.rev(BASE, TOKEN)).toEqual({ ok: false, kind: 'refused', status })
    expect(await client.pull(BASE, TOKEN)).toEqual({ ok: false, kind: 'refused', status })
    expect(await client.me(BASE, TOKEN)).toEqual({ ok: false, kind: 'refused', status })
    expect(await client.push(BASE, TOKEN, { state: {} })).toEqual({ ok: false, kind: 'refused', status })
  })
  test.each([408, 429])('%i is a passing server condition, not refused', async status => {
    const { client } = make(() => res(status, {}))
    expect(await client.pull(BASE, TOKEN)).toEqual({ ok: false, kind: 'server', status })
  })
})

describe('push', () => {
  const state = { workouts: [], routines: [] }
  test('PUTs { state, baseRev, baseWid, stamped:false }', async () => {
    const { client, calls } = make(() => res(200, { ok: true, ts: 5, rev: 8, wid: 'w2' }))
    const r = await client.push(BASE, TOKEN, { state, baseRev: 7, baseWid: 'w1' })
    expect(r).toEqual({ ok: true, ts: 5, rev: 8, wid: 'w2' })
    expect(calls[0].init.method).toBe('PUT')
    expect(calls[0].url).toBe(`${BASE}/api/data`)
    expect(JSON.parse(calls[0].init.body)).toEqual({ state, baseRev: 7, baseWid: 'w1', stamped: false })
    expect(calls[0].init.headers['Content-Type']).toBe('application/json')
  })
  test('409 passes the server state and rev', async () => {
    const theirs = { workouts: [{ id: 1 }] }
    const { client } = make(() => res(409, { error: 'conflict', rev: 9, state: theirs }))
    expect(await client.push(BASE, TOKEN, { state, baseRev: 7 })).toEqual({ ok: false, kind: 'conflict', rev: 9, state: theirs })
  })
  test('a 409 from a profile with no document carries an empty one', async () => {
    const { client } = make(() => res(409, { error: 'conflict', rev: 0, state: null }))
    expect(await client.push(BASE, TOKEN, { state, baseRev: 7 })).toEqual({ ok: false, kind: 'conflict', rev: 0, state: {} })
  })
  test('413 is too-large', async () => {
    const { client } = make(() => res(413, { error: 'too big' }))
    expect(await client.push(BASE, TOKEN, { state, baseRev: 1 })).toEqual({ ok: false, kind: 'too-large' })
  })
  test('401 is unauthorized, 503 and 500 are server', async () => {
    expect((await make(() => res(401, {})).client.push(BASE, TOKEN, { state })).kind).toBe('unauthorized')
    expect(await make(() => res(503, {})).client.push(BASE, TOKEN, { state })).toEqual({ ok: false, kind: 'server', status: 503 })
    expect(await make(() => res(500, {})).client.push(BASE, TOKEN, { state })).toEqual({ ok: false, kind: 'server', status: 500 })
  })
})

describe('failure handling', () => {
  test('a rejected fetch is offline, and never throws', async () => {
    const { client } = make(() => { throw new TypeError('Network request failed') })
    expect(await client.me(BASE, TOKEN)).toEqual({ ok: false, kind: 'offline' })
  })
  test('a hung request aborts after timeoutMs and is offline', async () => {
    const fetch = (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))))
    const client = createApiClient({ fetch, timeoutMs: 5 })
    expect(await client.rev(BASE, TOKEN)).toEqual({ ok: false, kind: 'offline' })
  })
  test('a timeout that fires while the body is being read is offline, not server', async () => {
    const fetch = (url, init) => Promise.resolve({ status: 200, ok: true, json: () => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')))) })
    const client = createApiClient({ fetch, timeoutMs: 5 })
    expect(await client.pull(BASE, TOKEN)).toEqual({ ok: false, kind: 'offline' })
  })
  test('a non-JSON success body is a server error, not a throw', async () => {
    const { client } = make(() => res(200, undefined))
    expect(await client.pull(BASE, TOKEN)).toEqual({ ok: false, kind: 'server', status: 200 })
  })
  test('a non-JSON 409 body is a server error', async () => {
    const { client } = make(() => res(409, undefined))
    expect((await client.push(BASE, TOKEN, { state: {} })).kind).toBe('server')
  })
  test('the token never appears in any failure result, even if the transport echoes it', async () => {
    const cases = [
      () => { throw new Error(`boom Bearer ${TOKEN}`) },
      () => res(401, { error: TOKEN }),
      () => res(500, { error: TOKEN }),
      () => res(409, { error: TOKEN, rev: 1, state: {} }),
      () => res(413, { error: TOKEN }),
    ]
    for (const h of cases) {
      const { client, calls } = make(h)
      for (const r of [await client.me(BASE, TOKEN), await client.rev(BASE, TOKEN), await client.pull(BASE, TOKEN), await client.push(BASE, TOKEN, { state: {} })]) {
        expect(JSON.stringify(r)).not.toContain(TOKEN)
      }
      for (const c of calls) expect(c.url).not.toContain(TOKEN)
    }
  })
})

describe('WHOOP', () => {
  const whoop = {
    configured: true, connected: true, fetchedAt: '2026-11-09T12:00:00.000Z', stale: false,
    days: [{ d: '2026-11-09', recovery: 67, hrv: 55.5, rhr: 52, calibrating: false, strain: 12.34 }],
    workouts: [{ d: '2026-11-09', sport: 'running', start: '2026-11-09T07:00:00.000Z', minutes: 60, strain: 8.1, avgHr: 140, kcal: 500 }],
  }

  test('getWhoop GETs /api/whoop with the bearer and returns the read', async () => {
    const { client, calls } = make(() => res(200, whoop))
    expect(await client.getWhoop(BASE, TOKEN)).toEqual({ ok: true, whoop })
    expect(calls[0].url).toBe(`${BASE}/api/whoop`)
    expect(calls[0].init.method).toBe('GET')
    expect(calls[0].init.headers.Authorization).toBe(`Bearer ${TOKEN}`)
    expect(calls[0].init.body).toBeUndefined()
  })

  test('getWhoop keeps only the fields of the read, and the error when there is one', async () => {
    const extra = { ...whoop, error: 'unavailable', access_token: 'NOT FOR THE PHONE', debug: { x: 1 } }
    const r = await make(() => res(200, extra)).client.getWhoop(BASE, TOKEN)
    expect(r).toEqual({ ok: true, whoop: { ...whoop, error: 'unavailable' } })
    const plain = await make(() => res(200, { configured: false, connected: false, fetchedAt: null, stale: false, days: [], workouts: [] })).client.getWhoop(BASE, TOKEN)
    expect(plain).toEqual({ ok: true, whoop: { configured: false, connected: false, fetchedAt: null, stale: false, days: [], workouts: [] } })
  })

  test('a getWhoop body of the wrong shape is a server error', async () => {
    for (const body of [{}, { ...whoop, days: null }, { ...whoop, workouts: {} }, { ...whoop, configured: 'yes' }, { ...whoop, connected: 1 }, []]) {
      expect(await make(() => res(200, body)).client.getWhoop(BASE, TOKEN)).toEqual({ ok: false, kind: 'server', status: 200 })
    }
  })

  test('whoopConnectLink POSTs with the bearer and no body, and returns the link', async () => {
    const url = `${BASE}/api/whoop/connect?c=abc`
    const { client, calls } = make(() => res(200, { url }))
    expect(await client.whoopConnectLink(BASE, TOKEN)).toEqual({ ok: true, url })
    expect(calls[0].url).toBe(`${BASE}/api/whoop/connect-link`)
    expect(calls[0].init.method).toBe('POST')
    expect(calls[0].init.headers.Authorization).toBe(`Bearer ${TOKEN}`)
    expect(calls[0].init.body).toBeUndefined()
    expect(calls[0].init.headers['Content-Type']).toBeUndefined()
  })

  test('whoopConnectLink: 503 is not set up; a body with no link is a server error', async () => {
    expect(await make(() => res(503, { error: 'WHOOP is not set up on this server' })).client.whoopConnectLink(BASE, TOKEN)).toEqual({ ok: false, kind: 'unconfigured' })
    expect(await make(() => res(200, {})).client.whoopConnectLink(BASE, TOKEN)).toEqual({ ok: false, kind: 'server', status: 200 })
    expect(await make(() => res(200, { url: '' })).client.whoopConnectLink(BASE, TOKEN)).toEqual({ ok: false, kind: 'server', status: 200 })
  })

  test('whoopDisconnect POSTs with the bearer and no body, and says what happened', async () => {
    const { client, calls } = make(() => res(200, { ok: true, revoked: false, wasConnected: true }))
    expect(await client.whoopDisconnect(BASE, TOKEN)).toEqual({ ok: true, revoked: false, wasConnected: true })
    expect(calls[0].url).toBe(`${BASE}/api/whoop/disconnect`)
    expect(calls[0].init.method).toBe('POST')
    expect(calls[0].init.headers.Authorization).toBe(`Bearer ${TOKEN}`)
    expect(calls[0].init.body).toBeUndefined()
    expect(await make(() => res(200, { ok: true, revoked: true, wasConnected: true })).client.whoopDisconnect(BASE, TOKEN)).toEqual({ ok: true, revoked: true, wasConnected: true })
    expect(await make(() => res(200, { revoked: true })).client.whoopDisconnect(BASE, TOKEN)).toEqual({ ok: false, kind: 'server', status: 200 })
  })

  test('the three calls fail the way every call does: 401, offline, 5xx, a refusal', async () => {
    const calls = c => [c.getWhoop(BASE, TOKEN), c.whoopConnectLink(BASE, TOKEN), c.whoopDisconnect(BASE, TOKEN)]
    for (const r of await Promise.all(calls(make(() => res(401, { error: 'not signed in' })).client))) expect(r).toEqual({ ok: false, kind: 'unauthorized' })
    for (const r of await Promise.all(calls(make(() => { throw new TypeError('Network request failed') }).client))) expect(r).toEqual({ ok: false, kind: 'offline' })
    for (const r of await Promise.all(calls(make(() => res(500, {})).client))) expect(r).toEqual({ ok: false, kind: 'server', status: 500 })
    for (const r of await Promise.all(calls(make(() => res(404, { error: 'not found' })).client))) expect(r).toEqual({ ok: false, kind: 'refused', status: 404 })
  })

  test('never logs a body, a link or the token, and the token is in no result or URL', async () => {
    const spies = ['log', 'info', 'warn', 'error', 'debug'].map(m => vi.spyOn(console, m).mockImplementation(() => {}))
    try {
      const marker = { ...whoop, url: `${BASE}/api/whoop/connect?c=MARK`, ok: true, revoked: true, wasConnected: true, error: TOKEN }
      const handlers = [
        () => res(200, marker),
        () => res(401, { error: TOKEN }),
        () => res(500, { error: TOKEN }),
        () => res(503, { error: TOKEN }),
        () => res(200, undefined),
        () => { throw new Error(`boom Bearer ${TOKEN}`) },
      ]
      for (const h of handlers) {
        const { client, calls } = make(h)
        for (const r of [await client.getWhoop(BASE, TOKEN), await client.whoopConnectLink(BASE, TOKEN), await client.whoopDisconnect(BASE, TOKEN)]) {
          if (!r.ok) expect(JSON.stringify(r)).not.toContain(TOKEN)
        }
        for (const c of calls) expect(c.url).not.toContain(TOKEN)
      }
      for (const spy of spies) expect(spy).not.toHaveBeenCalled()
    } finally {
      vi.restoreAllMocks()
    }
  })
})
