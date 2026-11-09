import { describe, expect, test } from 'vitest'
import { createNodeSqliteDb } from '../../scripts/node-sqlite.mjs'
import { resetIdsOf } from '../../../frontend/src/lib/sync-merge.js'
import { createSqliteFinishedWorkouts } from '../session/finished-workouts.js'
import { createCredentials } from './credentials.js'
import { buildPush } from './outbox.js'
import { createSqliteServerCopy, createSqliteSyncMeta } from './server-copy.js'
import { screenSource } from './source.js'
import { SERVER_WID_KEEP, createSync } from './sync-engine.js'

const BASE = 'https://gym.example.com'
const T0 = Date.parse('2026-11-09T09:14:00.000Z')
const HOUR = 3600_000
const iso = ms => new Date(ms).toISOString()
const clone = v => JSON.parse(JSON.stringify(v))

const OFFLINE = { ok: false, kind: 'offline' }
const UNAUTHORIZED = { ok: false, kind: 'unauthorized' }

const initialDoc = () => ({
  unit: 'kg',
  futureFeature: { nested: [1, { x: 'y' }], flag: true },
  routines: [{ id: 'r1', name: 'Push', ex: [{ id: 'bench' }] }],
  deleted: { workouts: { 'gone-1': 1730000000000 } },
  edited: { unit: 1730000000000 },
  workouts: [{ id: 'web-1', d: '2026-11-01', entries: [{ id: 'bench', sets: [{ w: 100, r: 5, done: true, type: 'quantum' }] }] }],
  _rev: 3,
  _wid: 'wid-3',
  _wids: ['wid-1', 'wid-2'],
})
const phone = (id, d = '2026-11-08') => ({ id, d, start: T0, end: T0 + 60_000, name: 'Push', entries: [{ id: 'bench', sets: [{ w: 60, r: 5, done: true }] }], vol: 300 })
const web = id => ({ id, d: '2026-11-07', entries: [], from: 'web' })

function fakeKeychain() {
  const m = new Map()
  return {
    m,
    AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'afterFirstUnlockThisDeviceOnly',
    getItemAsync: async k => (m.has(k) ? m.get(k) : null),
    setItemAsync: async (k, v) => { m.set(k, v) },
    deleteItemAsync: async k => { m.delete(k) },
  }
}

// One profile's document with the real server's bookkeeping: _rev counts writes, every write gets
// a new _wid and keeps its ancestors in _wids, a push over anything but the current rev/wid is a
// 409 carrying the current document, and new workouts come back stamped (_ts), as the API stamps
// what an unstamped writer sends. `once[method]` holds one-off answers or hooks.
function fakeServer(doc = initialDoc()) {
  let n = 0
  const srv = {
    doc: clone(doc),
    tokens: new Set(['T1']),
    codes: new Map([['GOODCODE', { token: 'T1', user: { id: 'u1', name: 'Mo', admin: false } }]]),
    renewTo: null,
    calls: [],
    pushes: [],
    once: {},
  }
  srv.write = state => {
    const prev = srv.doc
    const next = clone(state)
    next._wids = [...(prev._wids ?? []), ...(prev._wid ? [prev._wid] : [])].slice(-50)
    next._wid = `wid-s${++n}`
    next._rev = (prev._rev ?? 0) + 1
    srv.doc = next
    return next
  }
  srv.webAdds = w => {
    const s = clone(srv.doc)
    s.workouts = [...(s.workouts ?? []), w]
    srv.write(s)
  }
  const hook = async (name, args) => {
    const q = srv.once[name]
    if (!q?.length) return undefined
    const r = q.shift()
    return typeof r === 'function' ? r(...args) : r
  }
  const authed = token => srv.tokens.has(token)
  srv.client = {
    async redeem(base, code) {
      srv.calls.push('redeem')
      const h = await hook('redeem', [base, code]); if (h) return h
      const c = srv.codes.get(code)
      return c ? { ok: true, token: c.token, user: c.user } : { ok: false, kind: 'invalid-code' }
    },
    async me(base, token) {
      srv.calls.push('me')
      const h = await hook('me', [base, token]); if (h) return h
      if (!authed(token)) return UNAUTHORIZED
      const out = { ok: true, user: { id: 'u1', name: 'Mo', admin: false } }
      if (srv.renewTo) { srv.tokens.add(srv.renewTo); out.token = srv.renewTo }
      return out
    },
    async rev(base, token) {
      srv.calls.push('rev')
      const h = await hook('rev', [base, token]); if (h) return h
      if (!authed(token)) return UNAUTHORIZED
      return { ok: true, rev: srv.doc._rev ?? 0, ...(srv.doc._wid ? { wid: srv.doc._wid } : {}) }
    },
    async pull(base, token) {
      srv.calls.push('pull')
      const h = await hook('pull', [base, token]); if (h) return h
      if (!authed(token)) return UNAUTHORIZED
      return { ok: true, state: clone(srv.doc), rev: srv.doc._rev ?? 0 }
    },
    async push(base, token, body) {
      srv.calls.push('push')
      srv.pushes.push(clone(body))
      const h = await hook('push', [base, token, body]); if (h) return h
      if (!authed(token)) return UNAUTHORIZED
      // the same test as server.js: the wid is compared only when both sides have one
      const curRev = srv.doc._rev ?? 0
      if (body.baseRev !== curRev || (typeof body.baseWid === 'string' && srv.doc._wid && body.baseWid !== srv.doc._wid)) {
        return { ok: false, kind: 'conflict', state: clone(srv.doc), rev: curRev }
      }
      const state = clone(body.state)
      const held = new Set((srv.doc.workouts ?? []).map(w => w.id))
      for (const w of state.workouts ?? []) if (!held.has(w.id)) w._ts = 999
      const next = srv.write(state)
      return { ok: true, ts: null, rev: next._rev, wid: next._wid }
    },
  }
  return srv
}

async function setup({ server = fakeServer(), paired = true, local = [] } = {}) {
  const db = createNodeSqliteDb()
  const keychain = fakeKeychain()
  const credentials = createCredentials(keychain)
  const copy = createSqliteServerCopy(db)
  const meta = createSqliteSyncMeta(db)
  const workouts = createSqliteFinishedWorkouts(db)
  let clock = T0
  const now = () => clock
  for (const w of local) await workouts.put(w)
  if (paired) {
    await credentials.set({ token: 'T1' })
    await meta.set('server', BASE)
    await meta.set('profile', 'Mo')
  }
  const sync = createSync({ client: server.client, credentials, copy, workouts, meta, now })
  const pendingIds = async () => (await workouts.listPending()).map(w => w.id)
  const serverIds = () => server.doc.workouts.map(w => w.id)
  const fresh = () => { server.calls.length = 0 }
  return { sync, server, db, keychain, credentials, copy, meta, workouts, now, pendingIds, serverIds, fresh, tick: ms => { clock += ms } }
}

function gate() {
  let open
  const shut = new Promise(resolve => { open = resolve })
  return { shut, open }
}

describe('syncNow', () => {
  test('with no token it is unpaired and asks the server nothing', async () => {
    const t = await setup({ paired: false, local: [phone('p1')] })
    const r = await t.sync.syncNow()
    expect(r).toMatchObject({ paired: false, state: 'unpaired', pending: 1 })
    expect(r.problem).toBeUndefined()
    expect(t.server.calls).toEqual([])
  })

  test('the first sync pulls the document and stores it verbatim with its rev and wid', async () => {
    const t = await setup()
    const r = await t.sync.syncNow()
    expect(t.server.calls).toEqual(['me', 'rev', 'pull'])
    expect(await t.copy.get()).toEqual({ state: initialDoc(), rev: 3, wid: 'wid-3', pulledAt: iso(T0) })
    expect(r).toEqual({ paired: true, state: 'idle', lastSyncedAt: iso(T0), pending: 0, server: BASE, profile: 'Mo' })
    expect(t.server.pushes).toEqual([])
  })

  test('an unchanged revision with nothing pending is one rev call, and counts as synced', async () => {
    const t = await setup()
    await t.sync.syncNow()
    t.fresh(); t.tick(60_000)
    const r = await t.sync.syncNow()
    expect(t.server.calls).toEqual(['rev'])
    expect(r).toMatchObject({ state: 'idle', lastSyncedAt: iso(T0 + 60_000) })
  })

  test('a moved revision is pulled and replaces the copy', async () => {
    const t = await setup()
    await t.sync.syncNow()
    t.server.webAdds(web('web-2'))
    t.fresh()
    await t.sync.syncNow()
    expect(t.server.calls).toEqual(['rev', 'pull'])
    expect(await t.copy.get()).toMatchObject({ state: t.server.doc, rev: 4, wid: t.server.doc._wid })
  })

  test('a different wid at the same revision is pulled too', async () => {
    const t = await setup()
    await t.sync.syncNow()
    t.server.doc = { ...t.server.doc, unit: 'lb', _wid: 'wid-other', _wids: ['wid-1', 'wid-2', 'wid-3'] }
    t.fresh()
    await t.sync.syncNow()
    expect(t.server.calls).toEqual(['rev', 'pull'])
    expect((await t.copy.get()).state.unit).toBe('lb')
  })

  test('pending workouts go on top of the pulled document; then they are acked and the server copy is stored', async () => {
    const t = await setup({ local: [phone('p1'), phone('p2')] })
    const r = await t.sync.syncNow()
    expect(t.server.calls).toEqual(['me', 'rev', 'pull', 'push', 'pull'])
    const sent = t.server.pushes[0]
    expect(sent.baseRev).toBe(3)
    expect(sent.baseWid).toBe('wid-3')
    // the document the phone pulled, untouched, with its workouts extended
    expect(sent.state).toEqual({ ...initialDoc(), workouts: [...initialDoc().workouts, phone('p1'), phone('p2')] })
    expect(await t.pendingIds()).toEqual([])
    const acked = await t.db.getAll('SELECT id, acked_at FROM finished_workouts ORDER BY id')
    expect(acked).toEqual([{ id: 'p1', acked_at: iso(T0) }, { id: 'p2', acked_at: iso(T0) }])
    // the server's document as it stored it (stamped), not the one the phone sent
    const stored = await t.copy.get()
    expect(stored.state).toEqual(t.server.doc)
    expect(stored.state.workouts.find(w => w.id === 'p1')._ts).toBe(999)
    expect(stored).toMatchObject({ rev: 4, wid: t.server.doc._wid })
    expect(r).toMatchObject({ state: 'idle', pending: 0, lastSyncedAt: iso(T0) })
  })

  test('a 409 stores the newer document as the copy and retries once on top of it', async () => {
    const t = await setup({ local: [phone('p1')] })
    t.server.once.push = [() => { t.server.webAdds(web('web-2')) }]
    const r = await t.sync.syncNow()
    expect(t.server.pushes).toHaveLength(2)
    expect(t.server.pushes[1].baseRev).toBe(4)
    expect(t.server.pushes[1].state.workouts.map(w => w.id)).toEqual(['web-1', 'web-2', 'p1'])
    expect(t.serverIds()).toEqual(['web-1', 'web-2', 'p1'])
    expect(await t.pendingIds()).toEqual([])
    expect(r).toMatchObject({ state: 'idle', pending: 0 })
    expect(r.problem).toBeUndefined()
  })

  test('a second 409 is a conflict problem that keeps everything; the next sync clears it', async () => {
    const t = await setup({ local: [phone('p1')] })
    t.server.once.push = [() => { t.server.webAdds(web('web-2')) }, () => { t.server.webAdds(web('web-3')) }]
    const r = await t.sync.syncNow()
    expect(t.server.pushes).toHaveLength(2)
    expect(r).toMatchObject({ state: 'problem', problem: 'conflict', pending: 1 })
    expect(await t.meta.get('problem')).toBe('conflict')
    expect(await t.pendingIds()).toEqual(['p1'])
    expect(r.lastSyncedAt).toBeUndefined()
    expect((await t.copy.get()).state.workouts.map(w => w.id)).toEqual(['web-1', 'web-2', 'web-3'])

    t.tick(60_000)
    const again = await t.sync.syncNow()
    expect(again).toMatchObject({ state: 'idle', pending: 0, lastSyncedAt: iso(T0 + 60_000) })
    expect(again.problem).toBeUndefined()
    expect(await t.meta.get('problem')).toBeNull()
    expect(t.serverIds()).toEqual(['web-1', 'web-2', 'web-3', 'p1'])
  })

  test.each([
    ['rev', 'rev'],
    ['push', 'push'],
  ])('a 401 on %s unpairs: token gone, problem unpaired, every workout and the copy kept', async (_n, method) => {
    const t = await setup({ local: [phone('p1')] })
    await t.sync.syncNow()
    await t.workouts.put(phone('p2'))
    const before = await t.copy.get()
    if (method === 'rev') t.server.tokens.clear()
    else t.server.once.push = [UNAUTHORIZED]

    const r = await t.sync.syncNow()
    expect(r).toMatchObject({ paired: false, state: 'unpaired', problem: 'unpaired', pending: 1, server: BASE })
    expect(t.keychain.m.size).toBe(0)
    expect(await t.meta.get('problem')).toBe('unpaired')
    expect((await t.workouts.list()).map(w => w.id)).toEqual(['p1', 'p2'])
    expect(await t.pendingIds()).toEqual(['p2'])
    expect(await t.copy.get()).toEqual(before)

    t.fresh()
    expect(await t.sync.syncNow()).toMatchObject({ state: 'unpaired', problem: 'unpaired' })
    expect(t.server.calls).toEqual([])
  })

  test.each([
    ['rev', OFFLINE],
    ['pull', { ok: false, kind: 'server', status: 503 }],
    ['push', OFFLINE],
    ['push', { ok: false, kind: 'server', status: 500 }],
    ['me', OFFLINE],
  ])('%s failing with %o waits, stores no problem, and loses nothing', async (method, answer) => {
    const t = await setup({ local: [phone('p1')] })
    t.server.once[method] = [answer]
    const r = await t.sync.syncNow()
    expect(r).toMatchObject({ paired: true, state: 'waiting', pending: 1 })
    expect(r.problem).toBeUndefined()
    expect(await t.meta.get('problem')).toBeNull()
    expect(await t.pendingIds()).toEqual(['p1'])

    const again = await t.sync.syncNow()
    expect(again).toMatchObject({ state: 'idle', pending: 0 })
    expect(t.serverIds()).toEqual(['web-1', 'p1'])
  })

  test('a 413 is a too-large problem; nothing is acked', async () => {
    const t = await setup({ local: [phone('p1')] })
    t.server.once.push = [{ ok: false, kind: 'too-large' }]
    const r = await t.sync.syncNow()
    expect(r).toMatchObject({ state: 'problem', problem: 'too-large', pending: 1 })
    expect(await t.meta.get('problem')).toBe('too-large')
  })

  test('a server restored from an older backup: nothing stored over the copy, nothing sent, until resendAll', async () => {
    const t = await setup({ local: [phone('p1')] })
    const backup = clone(t.server.doc)
    await t.sync.syncNow()
    const synced = await t.copy.get()
    expect(t.serverIds()).toEqual(['web-1', 'p1'])

    t.server.doc = clone(backup) // the owner restored last night's backup: p1 is gone
    await t.workouts.put(phone('p2'))
    t.fresh()
    const r = await t.sync.syncNow()
    expect(r).toMatchObject({ state: 'problem', problem: 'server-older', pending: 1 })
    expect(await t.copy.get()).toEqual(synced)
    expect(t.server.calls).toEqual(['rev', 'pull'])
    expect(t.server.pushes).toHaveLength(1)

    // a web write on the restored server lands on the same revision number as the phone's copy
    t.server.webAdds(web('web-2'))
    expect(t.server.doc._rev).toBe(synced.rev)
    const still = await t.sync.syncNow()
    expect(still).toMatchObject({ state: 'problem', problem: 'server-older' })
    expect(t.server.pushes).toHaveLength(1)
    expect(await t.copy.get()).toEqual(synced)

    const after = await t.sync.resendAll()
    expect(after).toMatchObject({ state: 'idle', pending: 0 })
    expect(after.problem).toBeUndefined()
    expect(await t.meta.get('problem')).toBeNull()
    expect(t.serverIds()).toEqual(['web-1', 'web-2', 'p1', 'p2'])
    expect((await t.copy.get()).state).toEqual(t.server.doc)
  })

  test('resendAll that cannot reach the server stops there, keeps the problem and asks nothing more', async () => {
    const t = await setup({ local: [phone('p1')] })
    const backup = clone(t.server.doc)
    await t.sync.syncNow()
    t.server.doc = clone(backup)
    expect(await t.sync.syncNow()).toMatchObject({ problem: 'server-older' })
    t.fresh()
    t.server.once.pull = [OFFLINE]
    const r = await t.sync.resendAll()
    expect(t.server.calls).toEqual(['pull'])
    expect(r).toMatchObject({ state: 'problem', problem: 'server-older' })
    expect(await t.pendingIds()).toEqual([])
  })

  test('resendAll when not paired is just the status', async () => {
    const t = await setup({ paired: false, local: [phone('p1')] })
    expect(await t.sync.resendAll()).toMatchObject({ paired: false, state: 'unpaired', pending: 1 })
    expect(t.server.calls).toEqual([])
  })

  test('a 409 whose document does not descend from the copy is server-older too', async () => {
    const t = await setup({ local: [phone('p1')] })
    const backup = clone(t.server.doc)
    await t.sync.syncNow()
    const synced = await t.copy.get()
    t.server.doc = clone(backup)
    t.server.webAdds(web('web-2'))
    await t.workouts.put(phone('p2'))
    // a stale answer to the rev check lets the sync reach the push
    t.server.once.rev = [{ ok: true, rev: synced.rev, wid: synced.wid }]
    const r = await t.sync.syncNow()
    expect(r).toMatchObject({ state: 'problem', problem: 'server-older' })
    expect(t.server.pushes).toHaveLength(2)
    expect(await t.copy.get()).toEqual(synced)
    expect(t.serverIds()).toEqual(['web-1', 'web-2'])
  })

  test('after a kill between the 200 and markAcked, the next sync acks the workout and sends nothing', async () => {
    const t = await setup()
    await t.sync.syncNow()
    await t.workouts.put(phone('p1'))
    // what the engine sent before the app died: the PUT landed, the ack never ran
    const plan = buildPush(await t.copy.get(), await t.workouts.listPending())
    expect((await t.server.client.push(BASE, 'T1', plan)).ok).toBe(true)
    t.fresh()
    const r = await t.sync.syncNow()
    expect(t.server.calls).toEqual(['rev', 'pull'])
    expect(r).toMatchObject({ state: 'idle', pending: 0 })
    expect(t.serverIds()).toEqual(['web-1', 'p1'])
  })

  test('a 200 whose follow-up pull fails leaves the workout pending and on screen; the next sync acks it without resending', async () => {
    const t = await setup()
    await t.sync.syncNow()
    await t.workouts.put(phone('p1'))
    t.server.once.pull = [OFFLINE]
    const r = await t.sync.syncNow()
    expect(t.serverIds()).toEqual(['web-1', 'p1'])
    expect(r).toMatchObject({ state: 'waiting', pending: 1 })
    expect(await t.pendingIds()).toEqual(['p1'])
    const shown = screenSource({ copy: await t.copy.get(), bundled: { names: {} }, pending: await t.workouts.listPending() })
    expect(shown.state.workouts.map(w => w.id)).toContain('p1')

    t.fresh()
    expect(await t.sync.syncNow()).toMatchObject({ state: 'idle', pending: 0 })
    expect(t.server.calls).toEqual(['rev', 'pull'])
    expect(t.server.pushes).toHaveLength(1)
    expect(t.serverIds()).toEqual(['web-1', 'p1'])
  })

  test('killed between storing the copy and reconciling: the next sync at the same rev acks the held ids', async () => {
    const t = await setup({ local: [phone('p1')] })
    // the PUT landed and a pull stored the server's document, then the app died before the ack
    t.server.write({ ...t.server.doc, workouts: [...t.server.doc.workouts, phone('p1')] })
    await t.copy.put({ state: clone(t.server.doc), rev: t.server.doc._rev, wid: t.server.doc._wid, pulledAt: 'x' })
    expect(await t.pendingIds()).toEqual(['p1'])
    const r = await t.sync.syncNow()
    expect(t.server.calls).toEqual(['me', 'rev'])
    expect(r).toMatchObject({ state: 'idle', pending: 0 })
    expect(t.server.pushes).toEqual([])
  })

  test('a document without a wid at the copy\'s rev is pulled, not pushed over', async () => {
    const t = await setup()
    await t.sync.syncNow()
    const held = await t.copy.get()
    // the data folder replaced by an unrelated file from before write ids, at the same revision
    const other = { unit: 'lb', workouts: [{ id: 'other', d: '2026-01-01', entries: [] }], routines: [], _rev: held.rev }
    t.server.doc = clone(other)
    await t.workouts.put(phone('p1'))
    t.fresh()
    const r = await t.sync.syncNow()
    expect(t.server.calls).toEqual(['rev', 'pull'])
    expect(t.server.pushes).toEqual([])
    expect(t.server.doc).toEqual(other)
    expect(r).toMatchObject({ state: 'problem', problem: 'server-older', pending: 1 })
    expect(await t.copy.get()).toEqual(held)
  })

  test('a server whose window of write ids has moved past the copy\'s is not taken for an older one', async () => {
    const t = await setup({ local: [phone('p1')] })
    await t.sync.syncNow()
    for (let i = 0; i < 60; i++) t.server.webAdds(web(`web-x${i}`))
    expect(t.server.doc._wids).toHaveLength(SERVER_WID_KEEP)
    await t.workouts.put(phone('p2', '2026-11-09'))
    const r = await t.sync.syncNow()
    expect(r).toMatchObject({ state: 'idle', pending: 0 })
    expect(r.problem).toBeUndefined()
    expect(t.serverIds()).toHaveLength(1 + 1 + 60 + 1)
    expect(t.serverIds().slice(-1)).toEqual(['p2'])
  })

  test('the window constant is the server\'s WID_KEEP', () => {
    expect(SERVER_WID_KEEP).toBe(50)
  })

  test('a server at a lower rev is older, even when its wid list is full', async () => {
    const t = await setup()
    await t.sync.syncNow()
    for (let i = 0; i < 60; i++) t.server.webAdds(web(`web-x${i}`))
    await t.sync.syncNow()
    const synced = await t.copy.get()
    t.server.doc = { ...clone(t.server.doc), _rev: synced.rev - 1, _wid: 'restored', _wids: Array.from({ length: 50 }, (_, i) => `old-${i}`) }
    expect(await t.sync.syncNow()).toMatchObject({ state: 'problem', problem: 'server-older' })
    expect(await t.copy.get()).toEqual(synced)
  })

  test('a new profile with no document yet: the phone starts it with its own workouts', async () => {
    const server = fakeServer({})
    const t = await setup({ server, local: [phone('p1')] })
    const r = await t.sync.syncNow()
    expect(r).toMatchObject({ state: 'idle', pending: 0 })
    expect(t.server.pushes[0]).toEqual({ state: { workouts: [phone('p1')] }, baseRev: 0, baseWid: null })
    expect(t.serverIds()).toEqual(['p1'])
    expect((await t.copy.get()).rev).toBe(1)
  })

  test('pairing again after a web "Reset everything" does not bring back the workouts it wiped', async () => {
    const t = await setup({ local: [phone('p1')] })
    await t.sync.syncNow()
    expect(t.serverIds()).toEqual(['web-1', 'p1'])
    // the web wipes the profile: an empty copy stamped with what it wiped (sync-merge.js resetIdsOf)
    const wiped = resetIdsOf(t.server.doc)
    expect(wiped.workouts).toEqual(['web-1', 'p1'])
    t.server.write({ unit: 'kg', routines: [], workouts: [], resetAt: T0 + 1000, resetIds: wiped })
    // later the owner signs out everywhere and pairs this phone again: every ack is reset
    expect(await t.sync.pair('gym.example.com', 'GOODCODE')).toEqual({ ok: true })
    expect(t.serverIds()).toEqual([])
    expect(await t.pendingIds()).toEqual([])
    expect(t.server.pushes).toHaveLength(1)
  })

  test.each([
    ['push', 403],
    ['rev', 404],
    ['pull', 400],
  ])('a %s refused with %i is a refused problem that keeps the status and every workout', async (method, status) => {
    const t = await setup({ local: [phone('p1')] })
    t.server.once[method] = [{ ok: false, kind: 'refused', status }]
    const r = await t.sync.syncNow()
    expect(r).toMatchObject({ state: 'problem', problem: 'refused', httpStatus: status, pending: 1 })
    expect(await t.meta.get('problem')).toBe('refused')
    expect(await t.pendingIds()).toEqual(['p1'])

    const again = await t.sync.syncNow()
    expect(again).toMatchObject({ state: 'idle', pending: 0 })
    expect(again.problem).toBeUndefined()
    expect(again.httpStatus).toBeUndefined()
  })

  test('a pending workout the server has deleted is acked, not sent back', async () => {
    const doc = initialDoc()
    doc.deleted.workouts.p9 = 1730000000500
    const t = await setup({ server: fakeServer(doc), local: [phone('p9'), phone('p1')] })
    await t.sync.syncNow()
    expect(t.server.pushes[0].state.workouts.map(w => w.id)).toEqual(['web-1', 'p1'])
    expect(await t.pendingIds()).toEqual([])
    expect(t.serverIds()).toEqual(['web-1', 'p1'])
  })

  test('calls before a sync starts join it, and the state is syncing while it runs', async () => {
    const t = await setup()
    const g = gate()
    t.server.once.rev = [async () => { await g.shut }]
    const a = t.sync.syncNow()
    const b = t.sync.syncNow()
    expect(b).toBe(a)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect((await t.sync.status()).state).toBe('syncing')
    g.open()
    await a
    expect(t.server.calls.filter(c => c === 'rev')).toHaveLength(1)
    expect((await t.sync.status()).state).toBe('idle')
    // and a later call is a new sync
    const c = t.sync.syncNow()
    expect(c).not.toBe(a)
    await c
  })

  test('calls during a run schedule exactly one follow-up, which sends a workout finished meanwhile', async () => {
    const t = await setup({ local: [phone('p1')] })
    const g = gate()
    t.server.once.push = [async () => { await g.shut }]
    const first = t.sync.syncNow()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(t.server.calls).toEqual(['me', 'rev', 'pull', 'push'])
    // a workout is finished while the push is on its way, and the screen asks for a sync
    await t.workouts.put(phone('p2', '2026-11-09'))
    const next = t.sync.syncNow()
    expect(next).not.toBe(first)
    for (let i = 0; i < 3; i++) expect(t.sync.syncNow()).toBe(next)
    g.open()
    await first
    const r = await next
    expect(t.server.calls.filter(c => c === 'rev')).toHaveLength(2)
    expect(t.server.pushes.map(b => b.state.workouts.map(w => w.id))).toEqual([['web-1', 'p1'], ['web-1', 'p1', 'p2']])
    expect(r).toMatchObject({ state: 'idle', pending: 0 })
    expect(t.serverIds()).toEqual(['web-1', 'p1', 'p2'])
    // nothing more was scheduled
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(t.server.calls.filter(c => c === 'rev')).toHaveLength(2)
  })

  test('a local storage failure never rejects; it shows as a problem that is not stored', async () => {
    const t = await setup({ local: [phone('p1')] })
    const real = t.workouts.listPending
    let fail = true
    t.workouts.listPending = async () => {
      if (fail) { fail = false; throw new Error('disk I/O error') }
      return real()
    }
    const r = await t.sync.syncNow()
    expect(r).toMatchObject({ state: 'problem', problem: 'error', pending: 1 })
    expect(await t.meta.get('problem')).toBeNull()
    expect(await t.sync.syncNow()).toMatchObject({ state: 'idle', pending: 0 })
  })
})

describe('token renewal', () => {
  test('a sync asks /api/me at most once a day and keeps a renewed token', async () => {
    const t = await setup()
    t.server.renewTo = 'T2'
    await t.sync.syncNow()
    expect(t.server.calls[0]).toBe('me')
    expect(t.keychain.m.get('opengym.token')).toBe('T2')
    expect(await t.meta.get('lastRenewedAt')).toBe(iso(T0))

    t.server.renewTo = null
    t.server.tokens.delete('T1') // only the renewed token works now
    t.fresh(); t.tick(23 * HOUR)
    expect(await t.sync.syncNow()).toMatchObject({ state: 'idle' })
    expect(t.server.calls).toEqual(['rev'])

    t.fresh(); t.tick(2 * HOUR)
    await t.sync.syncNow()
    expect(t.server.calls).toEqual(['me', 'rev'])
    expect(t.keychain.m.get('opengym.token')).toBe('T2')
    expect(await t.meta.get('lastRenewedAt')).toBe(iso(T0 + 25 * HOUR))
  })

  test('a 401 from /api/me unpairs; a server error there does not stop the sync', async () => {
    const t = await setup({ local: [phone('p1')] })
    t.server.once.me = [{ ok: false, kind: 'server', status: 502 }]
    expect(await t.sync.syncNow()).toMatchObject({ state: 'idle', pending: 0 })
    expect(await t.meta.get('lastRenewedAt')).toBeNull()

    t.server.once.me = [UNAUTHORIZED]
    expect(await t.sync.syncNow()).toMatchObject({ state: 'unpaired', problem: 'unpaired' })
    expect(t.keychain.m.size).toBe(0)
  })
})

describe('pair', () => {
  test('a bad address is refused in words before anything is sent', async () => {
    const t = await setup({ paired: false })
    const r = await t.sync.pair('ftp://gym.example.com', 'GOODCODE')
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/https:\/\//)
    expect(t.server.calls).toEqual([])
    expect(await t.sync.pair('http://gym.example.com', 'GOODCODE')).toMatchObject({ ok: false, error: expect.stringMatching(/https/) })
    expect(await t.sync.pair('gym.example.com', '  ')).toMatchObject({ ok: false, error: expect.stringMatching(/code/i) })
    expect(t.server.calls).toEqual([])
  })

  test.each([
    ['a wrong or expired code', { ok: false, kind: 'invalid-code' }, /code/i],
    ['an unreachable server', OFFLINE, /reach gym\.example\.com/],
    ['a server that is not openGym', { ok: false, kind: 'server', status: 502 }, /gym\.example\.com/],
    ['an address that refuses the pairing route', { ok: false, kind: 'refused', status: 404 }, /gym\.example\.com answered, but not like an openGym server/],
  ])('%s is said in words, and the current pairing is untouched', async (_n, answer, words) => {
    const t = await setup({ local: [phone('p1')] })
    await t.sync.syncNow()
    const before = await t.copy.get()
    t.server.once.redeem = [answer]
    const r = await t.sync.pair('gym.example.com', 'NEWCODE')
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(words)
    expect(r.error).not.toMatch(/https?:\/\//)
    expect(t.keychain.m.get('opengym.token')).toBe('T1')
    expect(await t.meta.get('server')).toBe(BASE)
    expect(await t.copy.get()).toEqual(before)
    expect(await t.pendingIds()).toEqual([])
  })

  test('pairing stores the token, server and profile, forgets the old server, resends every workout, then syncs', async () => {
    const t = await setup({ paired: false, local: [phone('p1'), phone('p2')] })
    // left over from an earlier server
    await t.workouts.markAcked(['p1'], 'OLD')
    await t.copy.put({ state: { workouts: [] }, rev: 99, wid: 'old', pulledAt: 'OLD' })
    await t.meta.set('problem', 'conflict')
    await t.meta.set('lastSyncedAt', 'OLD')
    await t.meta.set('lastRenewedAt', iso(T0))

    const r = await t.sync.pair(' gym.example.com/ ', ' GOODCODE ')
    expect(r).toEqual({ ok: true })
    expect(t.server.calls).toEqual(['redeem', 'me', 'rev', 'pull', 'push', 'pull'])
    expect(t.keychain.m.get('opengym.token')).toBe('T1')
    expect(await t.meta.get('server')).toBe(BASE)
    expect(await t.meta.get('profile')).toBe('Mo')
    expect(t.serverIds()).toEqual(['web-1', 'p1', 'p2'])
    expect((await t.copy.get()).state).toEqual(t.server.doc)
    expect(await t.sync.status()).toEqual({ paired: true, state: 'idle', lastSyncedAt: iso(T0), pending: 0, server: BASE, profile: 'Mo' })
  })

  test('the old token is removed before the new address is written, and the new token is written last', async () => {
    const t = await setup({ local: [phone('p1')] })
    const log = []
    const realMeta = { ...t.meta }
    const realCreds = { ...t.credentials }
    t.meta.set = async (k, v) => { log.push(`meta.set ${k}`); return realMeta.set(k, v) }
    t.meta.clear = async () => { log.push('meta.clear'); return realMeta.clear() }
    t.credentials.clear = async () => { log.push('token.clear'); return realCreds.clear() }
    t.credentials.set = async v => { log.push('token.set'); return realCreds.set(v) }
    await t.sync.pair('gym.example.com', 'GOODCODE')
    const at = name => log.indexOf(name)
    expect(at('token.clear')).toBe(0)
    expect(at('token.clear')).toBeLessThan(at('meta.set server'))
    expect(at('meta.set server')).toBeLessThan(at('token.set'))
    expect(at('meta.set profile')).toBeLessThan(at('token.set'))
  })

  test('pairing while a sync runs still syncs with the new pairing afterwards', async () => {
    const t = await setup({ local: [phone('p1')] })
    const g = gate()
    t.server.once.rev = [async () => { await g.shut }]
    const first = t.sync.syncNow()
    await new Promise(resolve => setTimeout(resolve, 0))
    // the earlier sync's closing status read is slow
    const slow = gate()
    const realGet = t.meta.get
    let slowed = false
    t.meta.get = async k => {
      if (k === 'lastSyncedAt' && !slowed) { slowed = true; await slow.shut }
      return realGet(k)
    }
    const pairing = t.sync.pair('gym.example.com', 'GOODCODE')
    await new Promise(resolve => setTimeout(resolve, 0))
    g.open()
    setTimeout(() => slow.open(), 20)
    expect(await pairing).toEqual({ ok: true })
    await first
    const afterRedeem = t.server.calls.slice(t.server.calls.indexOf('redeem') + 1)
    // the earlier sync finishes (pull, push, pull), then the pairing's own sync starts afresh
    expect(afterRedeem).toEqual(['pull', 'push', 'pull', 'me', 'rev', 'pull'])
    expect((await t.copy.get()).state).toEqual(t.server.doc)
    expect(await t.pendingIds()).toEqual([])
  })

  test('a 401 problem is cleared by pairing again', async () => {
    const t = await setup({ local: [phone('p1')] })
    t.server.tokens.clear()
    expect(await t.sync.syncNow()).toMatchObject({ state: 'unpaired', problem: 'unpaired' })
    t.server.tokens.add('T1')
    expect(await t.sync.pair('gym.example.com', 'GOODCODE')).toEqual({ ok: true })
    const s = await t.sync.status()
    expect(s).toMatchObject({ paired: true, state: 'idle', pending: 0 })
    expect(s.problem).toBeUndefined()
  })
})

describe('forget', () => {
  test('clears the token, the copy and the meta, makes every workout pending, and keeps them all', async () => {
    const t = await setup({ local: [phone('p1')] })
    await t.sync.syncNow()
    expect(await t.pendingIds()).toEqual([])
    expect(await t.sync.forget()).toEqual({ paired: false, state: 'unpaired', pending: 1 })
    expect(t.keychain.m.size).toBe(0)
    expect(await t.copy.get()).toBeNull()
    for (const k of ['server', 'profile', 'lastSyncedAt', 'problem', 'lastRenewedAt']) expect(await t.meta.get(k)).toBeNull()
    expect((await t.workouts.list()).map(w => w.id)).toEqual(['p1'])
    expect(await t.pendingIds()).toEqual(['p1'])
    expect(await t.sync.status()).toEqual({ paired: false, state: 'unpaired', pending: 1 })
  })

  test('waits for a running sync, so the sync cannot write a copy back afterwards', async () => {
    const t = await setup({ local: [phone('p1')] })
    const g = gate()
    t.server.once.pull = [async () => { await g.shut }]
    const s = t.sync.syncNow()
    const f = t.sync.forget()
    await new Promise(resolve => setTimeout(resolve, 0))
    g.open()
    await Promise.all([s, f])
    expect(await t.copy.get()).toBeNull()
    expect(t.keychain.m.size).toBe(0)
    expect(await t.pendingIds()).toEqual(['p1'])
  })
})

describe('status', () => {
  test('says paired, server, profile, last sync and the pending count', async () => {
    const t = await setup({ local: [phone('p1')] })
    expect(await t.sync.status()).toEqual({ paired: true, state: 'idle', pending: 1, server: BASE, profile: 'Mo' })
    t.server.once.rev = [OFFLINE]
    await t.sync.syncNow()
    expect(await t.sync.status()).toEqual({ paired: true, state: 'waiting', pending: 1, server: BASE, profile: 'Mo' })
  })
})
