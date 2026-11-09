import { describe, expect, test } from 'vitest'
import { createNodeSqliteDb } from '../../scripts/node-sqlite.mjs'
import { resetIdsOf } from '../../../frontend/src/lib/sync-merge.js'
import { createSqliteFinishedWorkouts } from '../session/finished-workouts.js'
import { createSqliteWeighIns } from '../body/weigh-ins.js'
import { createSqliteHealthStore } from '../health/health-store.js'
import { createSqliteRoutineEdits } from '../plan/routine-edits.js'
import { createCredentials } from './credentials.js'
import { buildPush } from './outbox.js'
import { createSqliteServerCopy, createSqliteSyncMeta } from './server-copy.js'
import { readScreenSource, screenSource } from './source.js'
import { editBase, findRoutine } from '../plan/plan-view.js'
import { SERVER_WID_KEEP, createSync } from './sync-engine.js'

const BASE = 'https://gym.example.com'
const T0 = Date.parse('2026-11-09T09:14:00.000Z')
const HOUR = 3600_000
const iso = ms => new Date(ms).toISOString()
const clone = v => JSON.parse(JSON.stringify(v))

const OFFLINE = { ok: false, kind: 'offline' }
const UNAUTHORIZED = { ok: false, kind: 'unauthorized' }

const initialDoc = () => ({
  unit: 'lb',
  futureFeature: { nested: [1, { x: 'y' }], flag: true },
  routines: [{ id: 'r1', name: 'Push', ex: [{ id: 'bench' }] }],
  deleted: { workouts: { 'gone-1': 1730000000000 } },
  edited: { unit: 1730000000000 },
  workouts: [{ id: 'web-1', d: '2026-11-01', entries: [{ id: 'bench', sets: [{ w: 100, r: 5, done: true, type: 'quantum' }] }] }],
  _rev: 3,
  _wid: 'wid-3',
  _wids: ['wid-1', 'wid-2'],
})
// The API's test for an entry changed beyond its stamps (sync-stamps.js sameEntry).
const sameEntry = (a, b) => JSON.stringify({ ...a, _ts: 0, _f: 0, _u: 0 }) === JSON.stringify({ ...b, _ts: 0, _f: 0, _u: 0 })
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
// 409 carrying the current document, and new workouts and changed routines come back stamped
// (_ts), as the API stamps what an unstamped writer sends. `once[method]` holds one-off answers or
// hooks.
function fakeServer(doc = initialDoc()) {
  let n = 0
  const srv = {
    lastStamp: 5000, // every routine stamp is later than the last
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
  // The web stamps its own edits (a stamped writer): a routine it changes gets a new _ts.
  srv.webEditsRoutine = (rid, change) => {
    const s = clone(srv.doc)
    s.routines = s.routines.map(r => (r.id === rid ? { ...change(r), _ts: ++srv.lastStamp } : r))
    srv.write(s)
  }
  srv.webDeletesRoutine = rid => {
    const s = clone(srv.doc)
    s.routines = s.routines.filter(r => r.id !== rid)
    s.deleted = { ...s.deleted, routines: { ...s.deleted?.routines, [rid]: ++srv.lastStamp } }
    srv.write(s)
  }
  srv.routine = rid => srv.doc.routines.find(r => r.id === rid)
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
      // A routine the push changed, or a new one without a stamp, gets a new _ts (sync-stamps.js
      // stampUnstamped: sameEntry, then stampEntry); one sent as it is stored keeps its own.
      const before = new Map((Array.isArray(srv.doc.routines) ? srv.doc.routines : []).filter(r => r?.id != null).map(r => [r.id, r]))
      for (const r of Array.isArray(state.routines) ? state.routines : []) {
        if (!r || typeof r !== 'object' || r.id == null) continue
        const old = before.get(r.id)
        if (old ? !sameEntry(old, r) : r._ts == null) r._ts = ++srv.lastStamp
      }
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
  const weighIns = createSqliteWeighIns(db)
  const routineEdits = createSqliteRoutineEdits(db)
  let clock = T0
  const now = () => clock
  for (const w of local) await workouts.put(w)
  if (paired) {
    await credentials.set({ token: 'T1' })
    await meta.set('server', BASE)
    await meta.set('profile', 'Mo')
  }
  const sync = createSync({ client: server.client, credentials, copy, workouts, weighIns, routineEdits, meta, now })
  const pendingIds = async () => (await workouts.listPending()).map(w => w.id)
  const serverIds = () => server.doc.workouts.map(w => w.id)
  const fresh = () => { server.calls.length = 0 }
  return { sync, server, db, keychain, credentials, copy, meta, workouts, weighIns, routineEdits, now, pendingIds, serverIds, fresh, tick: ms => { clock += ms } }
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
    expect(r).toMatchObject({ paired: false, state: 'unpaired', pending: 1, pendingWeighIns: 0 })
    expect(r.problem).toBeUndefined()
    expect(t.server.calls).toEqual([])
  })

  test('the first sync pulls the document and stores it verbatim with its rev and wid', async () => {
    const t = await setup()
    const r = await t.sync.syncNow()
    expect(t.server.calls).toEqual(['me', 'rev', 'pull'])
    expect(await t.copy.get()).toEqual({ state: initialDoc(), rev: 3, wid: 'wid-3' })
    expect(r).toEqual({ paired: true, state: 'idle', lastSyncedAt: iso(T0), pending: 0, pendingWeighIns: 0, pendingRoutineEdits: 0, copyKey: '3|wid-3', server: BASE, profile: 'Mo' })
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
    t.server.doc = { ...t.server.doc, unit: 'kg', _wid: 'wid-other', _wids: ['wid-1', 'wid-2', 'wid-3'] }
    t.fresh()
    await t.sync.syncNow()
    expect(t.server.calls).toEqual(['rev', 'pull'])
    expect((await t.copy.get()).state.unit).toBe('kg')
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
    expect(await t.sync.resendAll()).toMatchObject({ paired: false, state: 'unpaired', pending: 1, pendingWeighIns: 0 })
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
    await t.copy.put({ state: clone(t.server.doc), rev: t.server.doc._rev, wid: t.server.doc._wid })
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
    expect(t.server.pushes[0]).toEqual({ state: { unit: 'lb', workouts: [phone('p1')] }, baseRev: 0, baseWid: null })
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
    t.server.write({ unit: 'lb', routines: [], workouts: [], resetAt: T0 + 1000, resetIds: wiped })
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
    await t.copy.put({ state: { workouts: [] }, rev: 99, wid: 'old' })
    await t.meta.set('problem', 'conflict')
    await t.meta.set('lastSyncedAt', 'OLD')
    await t.meta.set('lastRenewedAt', iso(T0))

    const r = await t.sync.pair(' gym.example.com/ ', ' GOODCODE ')
    expect(r).toEqual({ ok: true })
    // the pull after redeem checks the profile's unit before anything is stored
    expect(t.server.calls).toEqual(['redeem', 'pull', 'me', 'rev', 'pull', 'push', 'pull'])
    expect(t.keychain.m.get('opengym.token')).toBe('T1')
    expect(await t.meta.get('server')).toBe(BASE)
    expect(await t.meta.get('profile')).toBe('Mo')
    expect(t.serverIds()).toEqual(['web-1', 'p1', 'p2'])
    expect((await t.copy.get()).state).toEqual(t.server.doc)
    expect(await t.sync.status()).toEqual({ paired: true, state: 'idle', lastSyncedAt: iso(T0), pending: 0, pendingWeighIns: 0, pendingRoutineEdits: 0, copyKey: '4|wid-s1', server: BASE, profile: 'Mo' })
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
    // the pairing checks the unit (pull), the earlier sync finishes (pull, push, pull), then the
    // pairing's own sync starts afresh
    expect(afterRedeem).toEqual(['pull', 'pull', 'push', 'pull', 'me', 'rev', 'pull'])
    expect((await t.copy.get()).state).toEqual(t.server.doc)
    expect(await t.pendingIds()).toEqual([])
  })

  test.each([
    ['kilograms', 'kg', 'This profile uses kilograms. The app works in pounds for now, so it was not paired.'],
    ['any other unit', 'stone', 'This profile does not use pounds. The app works in pounds for now, so it was not paired.'],
  ])('a profile kept in %s is refused in words, and nothing of it is kept', async (_n, unit, words) => {
    const t = await setup({ server: fakeServer({ ...initialDoc(), unit }), paired: false, local: [phone('p1'), phone('p2')] })
    await t.workouts.markAcked(['p1'], 'OLD')
    const r = await t.sync.pair('gym.example.com', 'GOODCODE')
    expect(r).toEqual({ ok: false, error: words })
    expect(t.server.calls).toEqual(['redeem', 'pull'])
    expect(t.server.pushes).toEqual([])
    expect(t.keychain.m.size).toBe(0)
    expect(await t.meta.get('server')).toBeNull()
    expect(await t.meta.get('profile')).toBeNull()
    expect(await t.copy.get()).toBeNull()
    expect((await t.workouts.list()).map(w => w.id)).toEqual(['p1', 'p2'])
    expect(await t.pendingIds()).toEqual(['p2'])
    expect(await t.sync.status()).toEqual({ paired: false, state: 'unpaired', pending: 1, pendingWeighIns: 0, pendingRoutineEdits: 0 })
  })

  test('refusing a kilogram profile leaves the current pairing as it was', async () => {
    const t = await setup({ local: [phone('p1')] })
    await t.sync.syncNow()
    const before = await t.copy.get()
    t.server.once.pull = [{ ok: true, state: { ...initialDoc(), unit: 'kg' }, rev: 9 }]
    const r = await t.sync.pair('gym.example.com', 'GOODCODE')
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/kilograms/)
    expect(t.keychain.m.get('opengym.token')).toBe('T1')
    expect(await t.meta.get('server')).toBe(BASE)
    expect(await t.copy.get()).toEqual(before)
    expect(await t.pendingIds()).toEqual([])
  })

  test('a profile with no unit yet (a new one, no document) is paired', async () => {
    const t = await setup({ server: fakeServer({}), paired: false, local: [phone('p1')] })
    expect(await t.sync.pair('gym.example.com', 'GOODCODE')).toEqual({ ok: true })
    expect(t.serverIds()).toEqual(['p1'])
  })

  test('a pull that fails while checking the unit refuses in words, and nothing is kept', async () => {
    const t = await setup({ paired: false, local: [phone('p1')] })
    t.server.once.pull = [OFFLINE]
    const r = await t.sync.pair('gym.example.com', 'GOODCODE')
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/gym\.example\.com/)
    expect(r.error).toMatch(/new code/)
    expect(r.error).not.toMatch(/https?:\/\//)
    expect(t.server.pushes).toEqual([])
    expect(t.keychain.m.size).toBe(0)
    expect(await t.meta.get('server')).toBeNull()
    expect(await t.copy.get()).toBeNull()
    expect(await t.pendingIds()).toEqual(['p1'])
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
  test('leaves the Health links and the on flag alone', async () => {
    const t = await setup({ local: [phone('p1')] })
    const health = createSqliteHealthStore(t.db)
    const link = { kind: 'w', key: 'p1', syncId: 'opengym-w-p1', version: 5, hash: 'h', state: 'exported', error: null, updatedAt: 9 }
    await health.links.put(link)
    await health.state.set('on', '1')
    await t.sync.syncNow()
    await t.sync.forget()
    expect(await health.links.list('w')).toEqual([link])
    expect(await health.state.get('on')).toBe('1')
  })

  test('clears the token, the copy and the meta, makes every workout pending, and keeps them all', async () => {
    const t = await setup({ local: [phone('p1')] })
    await t.sync.syncNow()
    expect(await t.pendingIds()).toEqual([])
    expect(await t.sync.forget()).toEqual({ paired: false, state: 'unpaired', pending: 1, pendingWeighIns: 0, pendingRoutineEdits: 0 })
    expect(t.keychain.m.size).toBe(0)
    expect(await t.copy.get()).toBeNull()
    for (const k of ['server', 'profile', 'lastSyncedAt', 'problem', 'lastRenewedAt']) expect(await t.meta.get(k)).toBeNull()
    expect((await t.workouts.list()).map(w => w.id)).toEqual(['p1'])
    expect(await t.pendingIds()).toEqual(['p1'])
    expect(await t.sync.status()).toEqual({ paired: false, state: 'unpaired', pending: 1, pendingWeighIns: 0, pendingRoutineEdits: 0 })
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
    expect(await t.sync.status()).toEqual({ paired: true, state: 'idle', pending: 1, pendingWeighIns: 0, pendingRoutineEdits: 0, server: BASE, profile: 'Mo' })
    t.server.once.rev = [OFFLINE]
    await t.sync.syncNow()
    expect(await t.sync.status()).toEqual({ paired: true, state: 'waiting', pending: 1, pendingWeighIns: 0, pendingRoutineEdits: 0, server: BASE, profile: 'Mo' })
  })
})

describe('subscribe', () => {
  test('tells a listener on every state change, and stops after unsubscribe', async () => {
    const t = await setup({ local: [phone('p1')] })
    let calls = 0
    const off = t.sync.subscribe(() => { calls++ })
    const seen = []
    const off2 = t.sync.subscribe(async () => { seen.push((await t.sync.status()).state) })
    await t.sync.syncNow()
    expect(calls).toBeGreaterThanOrEqual(2) // started, finished
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(seen).toContain('idle')
    const before = calls
    off(); off2()
    await t.sync.forget()
    expect(calls).toBe(before)
  })

  test('forget, pair and resendAll notify; a throwing listener breaks nothing', async () => {
    const t = await setup({ paired: false })
    let calls = 0
    t.sync.subscribe(() => { throw new Error('listener bug') })
    t.sync.subscribe(() => { calls++ })
    expect(await t.sync.pair(BASE, 'GOODCODE')).toEqual({ ok: true })
    const afterPair = calls
    expect(afterPair).toBeGreaterThan(0)
    await t.sync.resendAll()
    expect(calls).toBeGreaterThan(afterPair)
    const afterResend = calls
    await t.sync.forget()
    expect(calls).toBeGreaterThan(afterResend)
  })
})

describe('copyKey in status', () => {
  test('is the stored copy rev and wid; a no-op sync keeps it, a pull changes it, forget removes it', async () => {
    const t = await setup()
    expect((await t.sync.status()).copyKey).toBeUndefined()
    const first = await t.sync.syncNow()
    expect(first.copyKey).toBe('3|wid-3')
    t.tick(60_000)
    const noop = await t.sync.syncNow()
    expect(noop.lastSyncedAt).not.toBe(first.lastSyncedAt)
    expect(noop.copyKey).toBe(first.copyKey)
    t.server.webAdds(web('web-2'))
    const pulled = await t.sync.syncNow()
    expect(pulled.copyKey).not.toBe(first.copyKey)
    expect((await t.sync.forget()).copyKey).toBeUndefined()
  })

  test('is read without the copy\'s body', async () => {
    const t = await setup()
    await t.sync.syncNow()
    t.copy.get = async () => { throw new Error('status read the whole body') }
    expect((await t.sync.status()).copyKey).toBe('3|wid-3')
  })
})

const typed = (d, w, t, extra = {}) => ({ d, op: 'set', w, t, ...extra })
const healthSet = (d, w, t, hk = 'u1', extra = {}) => ({ d, op: 'set', w, t, src: 'health', hk, ...extra })

describe('weigh-ins', () => {
  test('a pending weigh-in is pushed, then acked once the pulled copy holds it', async () => {
    const t = await setup()
    await t.weighIns.put(typed('2026-11-08', 181.2, T0 - 5))
    const r = await t.sync.syncNow()
    expect(t.server.calls).toEqual(['me', 'rev', 'pull', 'push', 'pull'])
    expect(t.server.doc.bodyweight).toEqual([{ d: '2026-11-08', w: 181.2, t: T0 - 5 }])
    expect(t.server.doc.workouts).toEqual(initialDoc().workouts)
    expect(await t.weighIns.listPending()).toEqual([])
    expect(r).toMatchObject({ state: 'idle', pending: 0, pendingWeighIns: 0 })
  })

  test('a superseded weigh-in is acked without a push', async () => {
    const server = fakeServer({ ...initialDoc(), bodyweight: [{ d: '2026-11-08', w: 180, t: T0 }] })
    const t = await setup({ server })
    await t.weighIns.put(healthSet('2026-11-08', 175, T0 - 9))
    const r = await t.sync.syncNow()
    expect(t.server.calls).toEqual(['me', 'rev', 'pull'])
    expect(await t.weighIns.listPending()).toEqual([])
    expect(r.pendingWeighIns).toBe(0)
    expect(t.server.doc.bodyweight).toEqual([{ d: '2026-11-08', w: 180, t: T0 }])
  })

  test('a weigh-in the server already holds is acked without a push', async () => {
    const server = fakeServer({ ...initialDoc(), bodyweight: [{ d: '2026-11-08', w: 181.2, t: 7 }] })
    const t = await setup({ server })
    await t.weighIns.put(typed('2026-11-08', 181.2, 7))
    await t.sync.syncNow()
    expect(t.server.pushes).toEqual([])
    expect(await t.weighIns.listPending()).toEqual([])
  })

  test('weigh-ins alone do not block workouts and ride in the same push', async () => {
    const t = await setup({ local: [phone('p1')] })
    await t.weighIns.put(typed('2026-11-08', 181.2, 5))
    await t.sync.syncNow()
    expect(t.server.pushes).toHaveLength(1)
    expect(t.serverIds()).toEqual(['web-1', 'p1'])
    expect(t.server.doc.bodyweight).toHaveLength(1)
  })

  test('a 409 re-applies on the new document: a web typed entry beats a pending Health set', async () => {
    const t = await setup()
    await t.sync.syncNow()
    await t.weighIns.put(healthSet('2026-11-08', 175, T0 - 9))
    t.server.once.push = [async () => {
      const s = clone(t.server.doc)
      s.bodyweight = [{ d: '2026-11-08', w: 182, t: T0 - 100 }]
      t.server.write(s)
      return undefined
    }]
    const r = await t.sync.syncNow()
    expect(r).toMatchObject({ state: 'idle', pendingWeighIns: 0 })
    expect(t.server.doc.bodyweight).toEqual([{ d: '2026-11-08', w: 182, t: T0 - 100 }])
    expect(await t.weighIns.listPending()).toEqual([])
  })

  test('a Health op replaces only the entry it names: the web edits that entry in place, arriving in a 409, and it stays', async () => {
    const imported = { d: '2026-11-08', w: 185, t: T0 - 50, src: 'health', hk: 'X' }
    const editedOnWeb = { ...imported, w: 182, t: T0 - 20 } // the web's sheet keeps src and hk
    for (const op of [healthSet('2026-11-08', 186, T0 - 9, 'Y', { baseT: T0 - 50 }), { d: '2026-11-08', op: 'remove', t: T0 - 9, src: 'health', baseT: T0 - 50 }]) {
      const t = await setup({ server: fakeServer({ ...initialDoc(), bodyweight: [imported] }) })
      await t.sync.syncNow()
      await t.weighIns.put(op)
      t.server.once.push = [async () => {
        const s = clone(t.server.doc)
        s.bodyweight = [editedOnWeb]
        t.server.write(s)
        return undefined
      }]
      expect(await t.sync.syncNow()).toMatchObject({ state: 'idle', pendingWeighIns: 0 })
      expect(t.server.doc.bodyweight).toEqual([editedOnWeb])
    }
    // With no edit in between, the same ops apply.
    const t = await setup({ server: fakeServer({ ...initialDoc(), bodyweight: [imported] }) })
    await t.sync.syncNow()
    await t.weighIns.put(healthSet('2026-11-08', 186, T0 - 9, 'Y', { baseT: T0 - 50 }))
    await t.sync.syncNow()
    expect(t.server.doc.bodyweight).toEqual([{ d: '2026-11-08', w: 186, t: T0 - 9, src: 'health', hk: 'Y' }])
  })

  test('a 409 still applies an op that the new document does not contradict', async () => {
    const t = await setup()
    await t.sync.syncNow()
    await t.weighIns.put(typed('2026-11-08', 181.2, T0 - 9))
    t.server.once.push = [async () => { t.server.webAdds(web('web-2')) }]
    await t.sync.syncNow()
    expect(t.server.doc.bodyweight).toEqual([{ d: '2026-11-08', w: 181.2, t: T0 - 9 }])
    expect(t.serverIds()).toContain('web-2')
  })

  test('pair, forget and resendAll make every weigh-in pending again', async () => {
    const t = await setup()
    await t.weighIns.put(typed('2026-11-08', 181.2, 5))
    await t.sync.syncNow()
    expect(await t.weighIns.listPending()).toEqual([])
    await t.sync.forget()
    expect((await t.weighIns.listPending()).map(o => o.d)).toEqual(['2026-11-08'])
    expect(await t.sync.status()).toMatchObject({ pendingWeighIns: 1 })

    await t.weighIns.markAcked([{ d: '2026-11-08', t: 5 }], iso(T0))
    t.server.doc = clone(initialDoc())
    expect((await t.sync.pair(BASE, 'GOODCODE')).ok).toBe(true)
    expect(t.server.doc.bodyweight).toEqual([{ d: '2026-11-08', w: 181.2, t: 5 }])

    await t.meta.set('problem', 'server-older')
    await t.weighIns.markAcked([{ d: '2026-11-08', t: 5 }], iso(T0))
    await t.sync.resendAll()
    expect(await t.weighIns.listPending()).toEqual([])
    // resendAll cleared the ack: it was pending until the stored copy held it again.
    expect(t.server.pushes.length).toBeGreaterThan(0)
  })

  test('status counts weigh-ins separately from workouts', async () => {
    const t = await setup({ paired: false, local: [phone('p1')] })
    await t.weighIns.put(typed('2026-11-08', 181.2, 5))
    await t.weighIns.put(typed('2026-11-09', 181, 6))
    expect(await t.sync.status()).toEqual({ paired: false, state: 'unpaired', pending: 1, pendingWeighIns: 2, pendingRoutineEdits: 0 })
  })
})

const delOnWeb = (t, d, at, keep = []) => {
  const s = clone(t.server.doc)
  s.bodyweight = keep
  s.deleted = { ...s.deleted, bodyweight: { [d]: at } }
  t.server.write(s)
}

describe('weigh-ins and the server record', () => {
  test('forget then pair after a web deletion: the day is not pushed back, the op is acked', async () => {
    const t = await setup()
    await t.weighIns.put(typed('2026-11-08', 181.2, T0 - 5))
    await t.sync.syncNow()
    delOnWeb(t, '2026-11-08', T0 + 1000)
    await t.sync.forget()
    expect((await t.sync.pair(BASE, 'GOODCODE')).ok).toBe(true)
    expect(t.server.doc.bodyweight).toEqual([])
    expect(t.server.doc.deleted.bodyweight).toEqual({ '2026-11-08': T0 + 1000 })
    expect(await t.weighIns.listPending()).toEqual([])
  })

  test('push ok but the pull fails, the web deletes the day: the next sync does not re-add it', async () => {
    const t = await setup()
    await t.sync.syncNow()
    await t.weighIns.put(typed('2026-11-08', 181.2, T0 - 5))
    t.server.once.pull = [OFFLINE]
    expect((await t.sync.syncNow()).state).toBe('waiting')
    expect(t.server.doc.bodyweight).toHaveLength(1)
    delOnWeb(t, '2026-11-08', T0 + 1000)
    t.server.pushes.length = 0
    await t.sync.syncNow()
    expect(t.server.pushes).toEqual([])
    expect(t.server.doc.bodyweight).toEqual([])
    expect(await t.weighIns.listPending()).toEqual([])
  })

  test('a typed set re-sent after re-pairing loses to a newer web typed edit', async () => {
    const t = await setup()
    await t.weighIns.put(typed('2026-11-08', 181.2, T0 - 5))
    await t.sync.syncNow()
    delOnWeb(t, '2026-11-08', 0, [{ d: '2026-11-08', w: 179, t: T0 + 50 }])
    await t.sync.forget()
    t.server.pushes.length = 0
    expect((await t.sync.pair(BASE, 'GOODCODE')).ok).toBe(true)
    expect(t.server.pushes).toEqual([])
    expect(t.server.doc.bodyweight).toEqual([{ d: '2026-11-08', w: 179, t: T0 + 50 }])
    expect(await t.weighIns.listPending()).toEqual([])
  })

  test('resendAll after the server went back to a backup puts an acked weigh-in on it again', async () => {
    const t = await setup()
    const backup = clone(t.server.doc)
    await t.weighIns.put(typed('2026-11-08', 181.2, T0 - 5))
    await t.sync.syncNow()
    expect(await t.weighIns.listPending()).toEqual([])
    t.server.doc = clone(backup)
    t.server.webAdds(web('web-9'))
    t.server.doc._wids = ['other']
    expect(await t.sync.syncNow()).toMatchObject({ state: 'problem', problem: 'server-older' })
    await t.sync.resendAll()
    expect(t.server.doc.bodyweight).toEqual([{ d: '2026-11-08', w: 181.2, t: T0 - 5 }])
    expect(await t.weighIns.listPending()).toEqual([])
  })

  test('the web edits a day after the phone decided to remove it, arriving in a 409: the removal is dropped', async () => {
    const t = await setup()
    await t.weighIns.put(typed('2026-11-08', 181.2, 5))
    await t.sync.syncNow()
    await t.weighIns.put({ d: '2026-11-08', op: 'remove', t: T0 - 1, baseT: 5 })
    t.server.once.push = [async () => {
      const s = clone(t.server.doc)
      s.bodyweight = [{ d: '2026-11-08', w: 178, t: T0 - 2 }]
      t.server.write(s)
      return undefined
    }]
    expect(await t.sync.syncNow()).toMatchObject({ state: 'idle', pendingWeighIns: 0 })
    expect(t.server.doc.bodyweight).toEqual([{ d: '2026-11-08', w: 178, t: T0 - 2 }])
  })

  test('createSync refuses to be built without a weigh-in store', () => {
    expect(() => createSync({ client: {}, credentials: {}, copy: {}, workouts: {}, routineEdits: {}, meta: {}, now: Date.now })).toThrow(/weighIns/)
  })
})

// Routines with their own stamps, as the web keeps them.
const planDoc = () => ({
  ...initialDoc(),
  routines: [
    { id: 'r1', name: 'Push', ex: [{ id: 'bench', sets: 3, reps: 5, pyramid: [{ w: 60, r: 8 }] }, { id: 'row', sets: 3, reps: 8 }], _ts: 1000, _f: { ex: 900 } },
    { id: 'r2', name: 'Pull', ex: [{ id: 'row', sets: 3, reps: 8 }], _ts: 1000 },
  ],
})
// What the Plan screen saves: the copy's routine as edited, on that routine's _ts.
const routineEdit = (base, change, t) => ({ rid: base.id, baseTs: base._ts ?? null, routine: change(clone(base)), t })
const setsOn = n => r => ({ ...r, ex: r.ex.map((s, i) => (i === 0 ? { ...s, sets: n } : s)) })
const swapped = r => ({ ...r, ex: [r.ex[1], r.ex[0]] })
const content = r => { const { _ts, _f, _u, ...rest } = r; return rest }

async function planSetup(doc = planDoc()) {
  const t = await setup({ server: fakeServer(doc) })
  await t.sync.syncNow()
  t.fresh()
  const edit = async (rid, change, at = T0 + 1) => {
    const base = (await t.copy.get()).state.routines.find(r => r.id === rid)
    const e = routineEdit(base, change, at)
    await t.routineEdits.put(e)
    return e
  }
  return { ...t, edit }
}

describe('routine edits', () => {
  test('an edit alone is pushed on the copy it was made on, then acked once the pulled copy holds it', async () => {
    const t = await planSetup()
    const mine = await t.edit('r1', r => setsOn(4)(swapped(r)))
    const r = await t.sync.syncNow()
    expect(t.server.calls).toEqual(['rev', 'push', 'pull'])
    const sent = t.server.pushes[0]
    expect(sent.baseRev).toBe(3)
    expect(sent.state).toEqual({ ...planDoc(), routines: [mine.routine, planDoc().routines[1]] })
    // the server stamped it; the stored copy is the server's, with every key on its own slot
    expect(t.server.routine('r1')._ts).toBeGreaterThan(1000)
    expect(content(t.server.routine('r1'))).toEqual(content(mine.routine))
    expect((await t.copy.get()).state).toEqual(t.server.doc)
    expect(await t.routineEdits.listPending()).toEqual([])
    expect(await t.db.getAll('SELECT rid, acked_at, superseded_at FROM routine_edits')).toEqual([{ rid: 'r1', acked_at: iso(T0), superseded_at: null }])
    expect((await t.routineEdits.get('r1')).sent).toEqual(mine.routine)
    expect(await t.routineEdits.listNotices()).toEqual([])
    expect(r).toMatchObject({ state: 'idle', pending: 0, pendingWeighIns: 0, pendingRoutineEdits: 0 })

    t.fresh()
    await t.sync.syncNow()
    expect(t.server.calls).toEqual(['rev'])
    expect(t.server.pushes).toHaveLength(1)
  })

  test('an edit made while the push is in flight is rebased on the landed one, and the next sync sends it', async () => {
    const t = await planSetup()
    const first = await t.edit('r1', setsOn(4))
    // The owner edits again between the PUT and the pull that follows it.
    let second
    t.server.once.pull = [async () => {
      second = await t.edit('r1', setsOn(5), T0 + 2)
      return undefined
    }]
    expect(await t.sync.syncNow()).toMatchObject({ state: 'idle', pendingRoutineEdits: 1 })
    expect(t.server.calls).toEqual(['rev', 'push', 'pull'])
    expect(content(t.server.routine('r1'))).toEqual(content(first.routine))
    const landed = t.server.routine('r1')._ts
    expect(landed).toBeGreaterThan(1000)
    expect(await t.routineEdits.listPending()).toEqual([{ rid: 'r1', baseTs: landed, routine: second.routine, sent: null, t: T0 + 2 }])
    expect(await t.routineEdits.listNotices()).toEqual([])

    t.fresh()
    expect(await t.sync.syncNow()).toMatchObject({ state: 'idle', pendingRoutineEdits: 0 })
    expect(t.server.calls).toEqual(['rev', 'push', 'pull'])
    expect(t.server.pushes[1].baseRev).toBe(4)
    // the second routine, on the stamps of the landed push it goes on top of
    expect(t.server.pushes[1].state.routines[0]).toEqual({ ...second.routine, _ts: landed })
    expect(second.routine._ts).toBe(1000)
    expect(content(t.server.routine('r1'))).toEqual(content(second.routine))
    expect(t.server.routine('r1')._ts).toBeGreaterThan(landed)
    expect(await t.routineEdits.listPending()).toEqual([])
    expect(await t.routineEdits.listNotices()).toEqual([])
  })

  test('a 409 whose document changed the same routine supersedes the edit, and no push carries it again', async () => {
    const t = await planSetup()
    await t.edit('r1', setsOn(4))
    t.server.once.push = [async () => { t.server.webEditsRoutine('r1', r => ({ ...r, name: 'Push A' })) }]
    const r = await t.sync.syncNow()
    expect(t.server.pushes).toHaveLength(1)
    expect(t.server.calls).toEqual(['rev', 'push'])
    expect(t.server.routine('r1')).toMatchObject({ name: 'Push A', ex: planDoc().routines[0].ex })
    expect((await t.copy.get()).state).toEqual(t.server.doc)
    expect(await t.routineEdits.listPending()).toEqual([])
    expect(await t.routineEdits.listNotices()).toEqual([{ rid: 'r1', name: 'Push', kind: 'changed', at: iso(T0) }])
    expect(r).toMatchObject({ state: 'idle', pendingRoutineEdits: 0 })
    expect(r.problem).toBeUndefined()

    t.fresh()
    await t.sync.syncNow()
    expect(t.server.calls).toEqual(['rev'])
  })

  test('a 409 that changed another routine still pushes the edit, on top of it, marked sent before each attempt', async () => {
    const t = await planSetup()
    const mine = await t.edit('r1', setsOn(4))
    const markSent = t.routineEdits.markSent
    t.routineEdits.markSent = async items => {
      t.server.calls.push(`markSent ${items.map(i => `${i.rid}@${i.t}`).join(',')}`)
      return markSent(items)
    }
    t.server.once.push = [async () => { t.server.webEditsRoutine('r2', r => ({ ...r, name: 'Pull A' })) }]
    const r = await t.sync.syncNow()
    expect(t.server.calls).toEqual(['rev', `markSent r1@${T0 + 1}`, 'push', `markSent r1@${T0 + 1}`, 'push', 'pull'])
    expect(t.server.pushes[1].baseRev).toBe(4)
    expect(t.server.pushes[1].state.routines[0]).toEqual(mine.routine)
    expect(t.server.pushes[1].state.routines[1]).toMatchObject({ name: 'Pull A' })
    expect(content(t.server.routine('r1'))).toEqual(content(mine.routine))
    expect(t.server.routine('r2').name).toBe('Pull A')
    expect(await t.routineEdits.listPending()).toEqual([])
    expect(await t.routineEdits.listNotices()).toEqual([])
    expect(r).toMatchObject({ state: 'idle', pendingRoutineEdits: 0 })
  })

  test('a routine deleted on the web supersedes the edit as deleted, and it is not pushed back', async () => {
    const t = await planSetup()
    await t.edit('r1', setsOn(4))
    t.server.webDeletesRoutine('r1')
    const r = await t.sync.syncNow()
    expect(t.server.calls).toEqual(['rev', 'pull'])
    expect(t.server.pushes).toEqual([])
    expect(t.server.doc.routines.map(x => x.id)).toEqual(['r2'])
    expect(await t.routineEdits.listPending()).toEqual([])
    expect(await t.routineEdits.listNotices()).toEqual([{ rid: 'r1', name: 'Push', kind: 'deleted', at: iso(T0) }])
    expect(r).toMatchObject({ state: 'idle', pendingRoutineEdits: 0 })
  })

  test('a push whose follow-up pull fails keeps the edit pending; the next sync acks it without sending it again', async () => {
    const t = await planSetup()
    const mine = await t.edit('r1', setsOn(4))
    t.server.once.pull = [OFFLINE]
    expect(await t.sync.syncNow()).toMatchObject({ state: 'waiting', pendingRoutineEdits: 1 })
    expect((await t.routineEdits.get('r1')).sent).toEqual(mine.routine)
    t.fresh()
    expect(await t.sync.syncNow()).toMatchObject({ state: 'idle', pendingRoutineEdits: 0 })
    expect(t.server.calls).toEqual(['rev', 'pull'])
    expect(t.server.pushes).toHaveLength(1)
    expect(await t.routineEdits.listNotices()).toEqual([])
  })

  test('an edit rides in the same push as a workout and a weigh-in', async () => {
    const t = await planSetup()
    const mine = await t.edit('r1', setsOn(4))
    await t.workouts.put(phone('p1'))
    await t.weighIns.put(typed('2026-11-08', 181.2, 5))
    await t.sync.syncNow()
    expect(t.server.pushes).toHaveLength(1)
    expect(t.serverIds()).toEqual(['web-1', 'p1'])
    expect(t.server.doc.bodyweight).toHaveLength(1)
    expect(content(t.server.routine('r1'))).toEqual(content(mine.routine))
    expect(await t.sync.status()).toMatchObject({ pending: 0, pendingWeighIns: 0, pendingRoutineEdits: 0 })
  })

  test('status counts routine edits waiting, paired or not', async () => {
    const t = await setup({ paired: false })
    await t.routineEdits.put(routineEdit(planDoc().routines[0], setsOn(4), 1))
    await t.routineEdits.put(routineEdit(planDoc().routines[1], setsOn(4), 2))
    expect(await t.sync.status()).toEqual({ paired: false, state: 'unpaired', pending: 0, pendingWeighIns: 0, pendingRoutineEdits: 2 })
  })

  test('an acked edit stays acked across forget and pair: a later web change brings no notice and nothing is sent', async () => {
    const t = await planSetup()
    await t.edit('r1', setsOn(4))
    await t.sync.syncNow()
    expect(await t.routineEdits.listPending()).toEqual([])
    t.server.webEditsRoutine('r1', r => ({ ...r, name: 'Push (web, later)' }))
    expect(await t.sync.forget()).toMatchObject({ pendingRoutineEdits: 0 })
    expect(await t.routineEdits.listPending()).toEqual([])
    t.server.pushes.length = 0
    expect((await t.sync.pair(BASE, 'GOODCODE')).ok).toBe(true)
    expect(t.server.pushes).toEqual([])
    expect(t.server.routine('r1').name).toBe('Push (web, later)')
    expect(await t.routineEdits.listPending()).toEqual([])
    expect(await t.routineEdits.listNotices()).toEqual([])
    expect(await t.db.getAll('SELECT rid, acked_at, superseded_at FROM routine_edits')).toEqual([{ rid: 'r1', acked_at: iso(T0), superseded_at: null }])
    expect(await t.sync.status()).toMatchObject({ pendingRoutineEdits: 0 })
  })

  test('resendAll after the server went back to a backup from before the edit puts it back', async () => {
    const t = await planSetup()
    const mine = await t.edit('r1', setsOn(4))
    await t.sync.syncNow()
    expect(await t.routineEdits.listPending()).toEqual([])
    t.server.doc = clone(planDoc())
    t.server.doc._wids = ['other']
    t.server.webAdds(web('web-9'))
    expect(await t.sync.syncNow()).toMatchObject({ state: 'problem', problem: 'server-older' })
    expect(await t.sync.resendAll()).toMatchObject({ state: 'idle', pendingRoutineEdits: 0 })
    expect(content(t.server.routine('r1'))).toEqual(content(mine.routine))
    expect(await t.routineEdits.listPending()).toEqual([])
    expect(await t.routineEdits.listNotices()).toEqual([])
  })

  test('resendAll: an edit acked long ago, of a routine the web changed since, is settled with no notice and not sent', async () => {
    const t = await planSetup()
    await t.edit('r1', setsOn(4))
    await t.sync.syncNow()
    t.server.webEditsRoutine('r1', r => ({ ...r, name: 'Push (web, later)' }))
    // restored from a backup taken after that web change: older than what the phone last saw
    t.server.doc = { ...clone(t.server.doc), _rev: 2, _wids: ['other'] }
    expect(await t.sync.syncNow()).toMatchObject({ state: 'problem', problem: 'server-older' })
    const before = clone(t.server.routine('r1'))
    t.server.pushes.length = 0
    expect(await t.sync.resendAll()).toMatchObject({ state: 'idle', pendingRoutineEdits: 0 })
    expect(t.server.pushes).toEqual([])
    expect(t.server.routine('r1')).toEqual(before)
    expect(await t.routineEdits.listPending()).toEqual([])
    expect(await t.routineEdits.listNotices()).toEqual([])
  })

  test('a save landing between the push reading the edits and markSent: the pull rebases it, no notice, and the next sync sends it', async () => {
    const t = await planSetup()
    const first = await t.edit('r1', setsOn(4))
    const markSent = t.routineEdits.markSent
    let second
    t.routineEdits.markSent = async items => {
      if (!second) second = await t.edit('r1', setsOn(5), T0 + 2)
      return markSent(items)
    }
    expect(await t.sync.syncNow()).toMatchObject({ state: 'idle', pendingRoutineEdits: 1 })
    expect(t.server.pushes[0].state.routines[0]).toEqual(first.routine)
    const landed = t.server.routine('r1')._ts
    expect(await t.routineEdits.listPending()).toEqual([{ rid: 'r1', baseTs: landed, routine: second.routine, sent: null, t: T0 + 2 }])
    expect(await t.routineEdits.listNotices()).toEqual([])

    t.fresh()
    expect(await t.sync.syncNow()).toMatchObject({ state: 'idle', pendingRoutineEdits: 0 })
    expect(t.server.calls).toEqual(['rev', 'push', 'pull'])
    expect(content(t.server.routine('r1'))).toEqual(content(second.routine))
    expect(await t.routineEdits.listPending()).toEqual([])
    expect(await t.routineEdits.listNotices()).toEqual([])
  })

  test('a save made on the copy from before the pull, landing just after markAcked, is pushed by the next sync with no notice', async () => {
    const t = await planSetup()
    const first = await t.edit('r1', setsOn(4))
    const before = (await t.copy.get()).state.routines[0] // what the Plan screen read
    const markAcked = t.routineEdits.markAcked
    let second
    t.routineEdits.markAcked = async (items, at) => {
      const r = await markAcked(items, at)
      if (!second) {
        second = routineEdit(before, setsOn(5), T0 + 2)
        await t.routineEdits.put(second)
      }
      return r
    }
    expect(await t.sync.syncNow()).toMatchObject({ state: 'idle', pendingRoutineEdits: 1 })
    expect(content(t.server.routine('r1'))).toEqual(content(first.routine))
    expect(await t.routineEdits.get('r1')).toEqual({ rid: 'r1', baseTs: 1000, routine: second.routine, sent: first.routine, t: T0 + 2 })
    expect(await t.routineEdits.listNotices()).toEqual([])

    t.fresh()
    expect(await t.sync.syncNow()).toMatchObject({ state: 'idle', pendingRoutineEdits: 0 })
    expect(t.server.calls).toEqual(['rev', 'push', 'pull'])
    expect(content(t.server.routine('r1'))).toEqual(content(second.routine))
    expect(await t.routineEdits.listPending()).toEqual([])
    expect(await t.routineEdits.listNotices()).toEqual([])
  })

  test('a move in a routine holding the same exercise twice is never sent: superseded as unsafe, the server untouched', async () => {
    const twins = { id: 'r3', name: 'Bench day', ex: [{ id: 'bench', sets: 3, reps: 5, pyramid: [{ w: 60, r: 8 }], stationId: 'rack-2' }, { id: 'bench', sets: 3, reps: 10 }], _ts: 1000 }
    const t = await planSetup({ ...planDoc(), routines: [...planDoc().routines, twins] })
    await t.edit('r3', r => ({ ...r, ex: [r.ex[1], r.ex[0]] }))
    const r = await t.sync.syncNow()
    expect(t.server.calls).toEqual(['rev'])
    expect(t.server.pushes).toEqual([])
    expect(t.server.routine('r3')).toEqual(twins)
    expect(await t.routineEdits.listPending()).toEqual([])
    expect(await t.routineEdits.listNotices()).toEqual([{ rid: 'r3', name: 'Bench day', kind: 'unsafe', at: iso(T0) }])
    expect(r).toMatchObject({ state: 'idle', pendingRoutineEdits: 0 })

    // a sets-only edit of the same routine goes
    await t.edit('r3', setsOn(4), T0 + 5)
    await t.sync.syncNow()
    expect(t.server.pushes).toHaveLength(1)
    expect(t.server.routine('r3').ex).toEqual([{ ...twins.ex[0], sets: 4 }, twins.ex[1]])
    expect(await t.routineEdits.listPending()).toEqual([])
  })

  test('createSync refuses to be built without a routine edits store', () => {
    expect(() => createSync({ client: {}, credentials: {}, copy: {}, workouts: {}, weighIns: {}, meta: {}, now: Date.now })).toThrow(/routineEdits/)
  })
})

// The screens show the bundled snapshot while no copy is held (unpaired), and when the copy cannot
// be built. Built before the web changed r1's reps from 8 to 6.
const SNAP_R1 = { id: 'r1', name: 'Push', ex: [{ id: 'bench', sets: 3, reps: 8, mode: 'reps', weight: 60 }], _ts: 1000 }
const snapshotDoc = () => ({ version: 1, example: false, names: {}, state: { unit: 'lb', routines: [clone(SNAP_R1)], workouts: [] } })
const webChangedR1 = (extra = {}) => ({ ...initialDoc(), routines: [{ ...clone(SNAP_R1), ex: [{ ...SNAP_R1.ex[0], reps: 6 }], _ts: 1500, _f: { ex: 1500 } }], ...extra })

// What the routine screen saves: the routine it shows, edited, on the base its source gives.
async function screenEdit(t, change, at) {
  const bundled = snapshotDoc()
  const src = await readScreenSource({ finished: t.workouts, serverCopy: t.copy, bundled, routineEdits: t.routineEdits })
  const shown = findRoutine(src.state, 'r1')
  const { base, fresh } = editBase({ copy: src.copy, bundled }, 'r1')
  await t.routineEdits.put({ rid: 'r1', baseTs: base?._ts ?? null, routine: change(clone(shown)), t: at, fresh })
  return { shown }
}

describe('routine edits made on the bundled snapshot', () => {
  test('paired with a copy the screens cannot build from: an edit on the snapshot is measured against the snapshot, superseded, and the server untouched', async () => {
    // a custom exercise whose name is not text, used by a workout: screenSource throws on it
    const doc = webChangedR1({ customEx: [{ id: 'cust', n: 5 }], workouts: [{ id: 'w1', d: '2026-11-01', entries: [{ id: 'cust', sets: [] }] }] })
    doc.routines[0].ex[0].note = 'pause 1s'
    const t = await setup({ server: fakeServer(doc) })
    await t.sync.syncNow()
    const before = clone(t.server.routine('r1'))
    const { shown } = await screenEdit(t, setsOn(4), T0 + 1)
    expect(shown.ex[0].reps).toBe(8) // the screen showed the snapshot
    t.fresh()
    expect(await t.sync.syncNow()).toMatchObject({ state: 'idle', pendingRoutineEdits: 0 })
    expect(t.server.pushes).toEqual([])
    expect(t.server.routine('r1')).toEqual(before)
    expect(await t.routineEdits.listNotices()).toEqual([{ rid: 'r1', name: 'Push', kind: 'changed', at: iso(T0) }])
  })

  // Forget, then an edit on the snapshot, then pairing the same server again (as changing the
  // server's address does). The row starts over on the snapshot's base, whatever it held: an ack's
  // `sent`, or a pending edit's older base, would let the snapshot's routine over the server's.
  test('an edit acked before forget, an unpaired edit, re-pair: the web\'s change since the snapshot stands, with a notice', async () => {
    const t = await setup({ server: fakeServer(webChangedR1()) })
    await t.sync.syncNow()
    await screenEdit(t, setsOn(4), T0 + 1)
    await t.sync.syncNow()
    expect(await t.routineEdits.listPending()).toEqual([])
    expect(t.server.routine('r1').ex[0]).toMatchObject({ sets: 4, reps: 6 })

    await t.sync.forget()
    const { shown } = await screenEdit(t, setsOn(5), T0 + 2)
    expect(shown.ex[0]).toMatchObject({ sets: 3, reps: 8 })
    const before = clone(t.server.routine('r1'))
    t.server.pushes.length = 0
    expect((await t.sync.pair(BASE, 'GOODCODE')).ok).toBe(true)
    expect(t.server.pushes).toEqual([])
    expect(t.server.routine('r1')).toEqual(before)
    expect(await t.routineEdits.listPending()).toEqual([])
    expect(await t.routineEdits.listNotices()).toEqual([{ rid: 'r1', name: 'Push', kind: 'changed', at: iso(T0) }])
  })

  test('an edit still pending at forget, an unpaired edit, re-pair: the web\'s change since the snapshot stands, with a notice', async () => {
    const t = await setup({ server: fakeServer(webChangedR1()) })
    await t.sync.syncNow()
    await screenEdit(t, setsOn(4), T0 + 1)
    await t.sync.forget()
    const { shown } = await screenEdit(t, setsOn(5), T0 + 2)
    expect(shown.ex[0]).toMatchObject({ sets: 3, reps: 8 })
    const before = clone(t.server.routine('r1'))
    t.server.pushes.length = 0
    expect((await t.sync.pair(BASE, 'GOODCODE')).ok).toBe(true)
    expect(t.server.pushes).toEqual([])
    expect(t.server.routine('r1')).toEqual(before)
    expect(await t.routineEdits.listNotices()).toEqual([{ rid: 'r1', name: 'Push', kind: 'changed', at: iso(T0) }])
  })

  test('an unpaired edit of a routine unchanged since the snapshot goes on pairing, over an older pending one', async () => {
    const t = await setup({ server: fakeServer({ ...initialDoc(), routines: [clone(SNAP_R1)] }) })
    await t.sync.syncNow()
    t.server.once.push = [OFFLINE]
    await screenEdit(t, setsOn(4), T0 + 1)
    await t.sync.syncNow()
    await t.sync.forget()
    await screenEdit(t, setsOn(5), T0 + 2)
    expect((await t.sync.pair(BASE, 'GOODCODE')).ok).toBe(true)
    expect(content(t.server.routine('r1'))).toEqual({ ...content(SNAP_R1), ex: [{ ...SNAP_R1.ex[0], sets: 5 }] })
    expect(await t.routineEdits.listPending()).toEqual([])
    expect(await t.routineEdits.listNotices()).toEqual([])
  })
})
