import { describe, expect, test } from 'vitest'
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
  test('other 400 is a server error with its status', async () => {
    const { client } = make(() => res(400, { error: 'x' }))
    expect(await client.redeem(BASE, 'X')).toEqual({ ok: false, kind: 'server', status: 400 })
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
