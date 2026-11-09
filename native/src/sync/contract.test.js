// The phone's sync engine against the real API: api/server.js in a child process with a temp
// DATA_DIR, a pairing code from api/scripts/pair-code.mjs, Node's fetch, real SQLite on a file.
// Nothing here reads the owner's data/ folder.
//
// The native CI job does not install api/'s dependencies, so without api/node_modules this
// skips and says why. Run it locally before merging (cd api && npm install).
import { execFile, spawn } from 'node:child_process'
import crypto from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { describe, expect, onTestFinished, test } from 'vitest'
import { boundPort } from '../../../api/test/helpers.mjs'
import { SQLITE_DRIVERS } from '../../scripts/node-sqlite.mjs'
import { createSqliteWeighIns } from '../body/weigh-ins.js'
import { createSqliteRoutineEdits } from '../plan/routine-edits.js'
import { createSqliteFinishedWorkouts } from '../session/finished-workouts.js'
import { createApiClient } from './api-client.js'
import { createCredentials } from './credentials.js'
import { createSqliteServerCopy, createSqliteSyncMeta } from './server-copy.js'
import { createSync } from './sync-engine.js'

const API = fileURLToPath(new URL('../../../api/', import.meta.url))
const HAS_API_DEPS = existsSync(join(API, 'node_modules'))
const [, createRealDb] = SQLITE_DRIVERS.find(([name]) => name === 'node sqlite file')
const run = promisify(execFile)

const UID = 'u_owner'
const SECRET = crypto.randomBytes(32).toString('hex')
const T0 = Date.parse('2026-11-09T10:00:00.000Z')
// A browser session that outlives the test, without reading the clock (server.js sessionUser
// only checks that the expiry is still ahead).
const COOKIE_EXP = Date.parse('2100-01-01T00:00:00.000Z')
// What the API never sends a client (server.js forClient).
const HIDDEN = ['_unstamped', '_prior']

// The owner's document as the web left it: keys this app does not know, a set type it does not
// know, records of removals and edits, two web workouts and two routines, and the server's own
// notes that no client is ever sent (`_prior`, `_unstamped`; sync-stamps.js notePrior/ownRecord).
const fixture = () => ({
  unit: 'lb',
  lang: 'en',
  futureFeature: { nested: [1, { x: 'y' }], flag: true },
  routines: [
    { id: 'r1', name: 'Push', ex: [{ id: '0025', sets: 3, reps: 5, mode: 'reps', weight: 60, prog: 'linear' }], _ts: 1730000000000 },
    { id: 'r2', name: 'Pull', ex: [{ id: '0027', sets: 3, reps: 8, mode: 'reps' }] },
  ],
  queue: ['r2', 'r1'],
  exWeights: { '0025': { w: 60 } },
  deleted: { workouts: { 'gone-1': 1730000000000 } },
  edited: { unit: 1730000000000 },
  workouts: [
    {
      id: 'web-1', d: '2026-11-01', name: 'Push', start: 1761987600000, end: 1761990000000, vol: 1860, prs: [],
      entries: [{ id: '0025', sets: [{ w: 60, r: 5, done: true }, { w: 40, r: 8, done: true, type: 'clusterSet', cluster: [3, 3, 2] }] }],
    },
    { id: 'web-2', d: '2026-11-03', name: 'Pull', start: 1762160400000, end: 1762162800000, vol: 0, prs: [], entries: [] },
  ],
  _prior: { queue: ['13.1x2y3z'], 'routines|r1|name': ['6.abc123'] },
  _unstamped: { fp: '27.abc.def', ed: { unit: 1730000000000 } },
  _rev: 12,
  _wid: 'a1b2c3d4e5f60718',
  _wids: ['0000000000000001'],
})

const phone = (id, d) => ({
  id, d, start: T0, end: T0 + 45 * 60_000, name: 'Push', routineIds: ['r1'],
  entries: [{ id: '0025', sets: [{ w: 62.5, r: 5, done: true }, { w: 20, r: 10, done: true, warmup: true }], topW: 62.5 }],
  prs: [], vol: 312.5,
})

// Same construction as server.js makeSession() for a browser cookie: `uid:exp:sv`, HMAC-SHA256.
function webCookie(sv = 0) {
  const payload = `${UID}:${COOKIE_EXP}:${sv}`
  return { Cookie: `gymsid=${payload}.${crypto.createHmac('sha256', SECRET).update(payload).digest('base64url')}` }
}

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

// `state: null` starts a profile with no document at all, as a new one is.
async function startServer({ state = fixture() } = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'opengym-contract-'))
  writeFileSync(join(dataDir, 'secret'), SECRET, { mode: 0o600 })
  writeFileSync(join(dataDir, 'db.json'), JSON.stringify({ users: [{ id: UID, name: 'Owner', created: new Date(T0).toISOString() }], creds: [], subs: [], invites: [] }))
  if (state) writeFileSync(join(dataDir, `state-${UID}.json`), JSON.stringify(state))
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost' },
  })
  let log = ''
  child.stdout.on('data', d => { log += d })
  child.stderr.on('data', d => { log += d })
  onTestFinished(() => {
    child.kill('SIGKILL')
    rmSync(dataDir, { recursive: true, force: true })
  })
  const port = await boundPort(child, () => log)
  const api = `http://localhost:${port}`
  return {
    port,
    api,
    file: () => JSON.parse(readFileSync(join(dataDir, `state-${UID}.json`), 'utf8')),
    async pairCode() {
      const { stdout } = await run(process.execPath, ['scripts/pair-code.mjs'], { cwd: API, env: { ...process.env, DATA_DIR: dataDir, PORT: String(port) } })
      return /Pairing code: (\S+)/.exec(stdout)[1]
    },
    // What a signed-in web tab does: read the document, add a workout, write it back over the
    // revision it read.
    // The same, for the web setting one day's weight.
    async webWeighs(entry) {
      const cookie = webCookie()
      const got = await (await fetch(`${api}/api/data`, { headers: cookie })).json()
      const state = { ...got.state, bodyweight: [...(got.state.bodyweight ?? []), entry] }
      const res = await fetch(`${api}/api/data`, {
        method: 'PUT',
        headers: { ...cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ state, baseRev: got.rev, baseWid: got.state._wid, stamped: true }),
      })
      expect(res.status).toBe(200)
    },
    async webAdds(workout) {
      const cookie = webCookie()
      const got = await (await fetch(`${api}/api/data`, { headers: cookie })).json()
      const state = { ...got.state, workouts: [...got.state.workouts, workout] }
      const res = await fetch(`${api}/api/data`, {
        method: 'PUT',
        headers: { ...cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ state, baseRev: got.rev, baseWid: got.state._wid, stamped: true }),
      })
      expect(res.status).toBe(200)
    },
  }
}

function phoneApp(db, { keychain = fakeKeychain(), client = createApiClient({ fetch: globalThis.fetch, timeoutMs: 10_000 }) } = {}) {
  const workouts = createSqliteFinishedWorkouts(db)
  const copy = createSqliteServerCopy(db)
  const meta = createSqliteSyncMeta(db)
  const weighIns = createSqliteWeighIns(db)
  const routineEdits = createSqliteRoutineEdits(db)
  const sync = createSync({ client, credentials: createCredentials(keychain), copy, workouts, weighIns, routineEdits, meta, now: () => T0 })
  return { sync, workouts, weighIns, routineEdits, copy, meta, keychain, client }
}

async function paired(server, db = createRealDb(), options) {
  const app = phoneApp(db, options)
  expect(await app.sync.pair(server.api, await server.pairCode())).toEqual({ ok: true })
  return { ...app, db }
}

const without = (doc, keys) => Object.fromEntries(Object.entries(doc).filter(([k]) => !keys.includes(k)))
const stripStamps = w => without(w, ['_ts', '_f'])

// Every key of the original document, apart from the server's bookkeeping and the workouts,
// holds exactly the value it had; every web workout is exactly as it was.
function expectOriginalKept(file) {
  const original = fixture()
  for (const [k, v] of Object.entries(original)) {
    if (['_rev', '_wid', '_wids', 'workouts', ...HIDDEN].includes(k)) continue
    expect(file[k], k).toEqual(v)
  }
  for (const w of original.workouts) expect(file.workouts.find(x => x.id === w.id)).toEqual(w)
  expect(file._wids).toContain(original._wid)
}

// The server's own notes never reach the phone: not in the copy, not anywhere in SQLite. The
// server keeps `_prior` across the phone's pushes. It rebuilds `_unstamped` on every push from a
// writer that does not stamp, and drops one that is not that writer's (sync-stamps.js ownRecord):
// it is gone after the phone's first push by the server's rule, not the phone's doing.
async function expectHiddenStayOnServer(app, file, { pushed }) {
  const stored = await app.copy.get()
  for (const k of HIDDEN) expect(stored.state, k).not.toHaveProperty(k)
  const raw = JSON.stringify(await app.db.getAll('SELECT body FROM server_copy'))
  for (const k of HIDDEN) expect(raw).not.toContain(k)
  expect(file._prior).toEqual(fixture()._prior)
  if (pushed) expect(file).not.toHaveProperty('_unstamped')
  else expect(file._unstamped).toEqual(fixture()._unstamped)
}

function expectOnce(file, workout) {
  const found = file.workouts.filter(x => x.id === workout.id)
  expect(found, workout.id).toHaveLength(1)
  expect(stripStamps(found[0])).toEqual(workout)
}

const TITLE = HAS_API_DEPS
  ? 'sync engine against a real api/server.js'
  : 'sync engine against a real api/server.js (SKIPPED: api/node_modules is absent; run `npm install` in api/ to run it)'

describe.skipIf(!HAS_API_DEPS)(TITLE, { timeout: 30_000 }, () => {
  test('pair, then pull: the copy is the server file, apart from the keys the API hides', async () => {
    const server = await startServer()
    const app = await paired(server)
    const stored = await app.copy.get()
    const file = server.file()
    expect(file).toEqual(fixture())
    expect(stored.state).toEqual(without(file, HIDDEN))
    expect(stored.state).toEqual(without(fixture(), HIDDEN))
    await expectHiddenStayOnServer(app, file, { pushed: false })
    expect(stored.rev).toBe(12)
    expect(stored.wid).toBe(fixture()._wid)
    expect(await app.sync.status()).toEqual({
      paired: true, state: 'idle', lastSyncedAt: new Date(T0).toISOString(), pending: 0, pendingWeighIns: 0, pendingRoutineEdits: 0, copyKey: `${stored.rev}|${stored.wid}`, server: server.api, profile: 'Owner',
    })
    // the token is in the Keychain and nowhere in SQLite
    const token = app.keychain.m.get('opengym.token')
    expect(token).toMatch(/^u_owner:\d+:0:b\./)
    for (const table of ['server_copy', 'sync_meta', 'finished_workouts']) {
      expect(JSON.stringify(await app.db.getAll(`SELECT * FROM ${table}`))).not.toContain(token)
    }
  })

  test('two finished workouts sync: the server file has both and every original key and value; both rows acked', async () => {
    const server = await startServer()
    const app = await paired(server)
    const p1 = phone('11111111-1111-4111-8111-111111111111', '2026-11-08')
    const p2 = phone('22222222-2222-4222-8222-222222222222', '2026-11-09')
    await app.workouts.put(p1)
    await app.workouts.put(p2)

    expect(await app.sync.syncNow()).toMatchObject({ state: 'idle', pending: 0 })
    const file = server.file()
    expectOriginalKept(file)
    expectOnce(file, p1)
    expectOnce(file, p2)
    expect(file.workouts).toHaveLength(4)
    expect(await app.workouts.listPending()).toEqual([])
    const rows = await app.db.getAll('SELECT id, acked_at FROM finished_workouts ORDER BY id')
    expect(rows.map(r => r.acked_at)).toEqual([new Date(T0).toISOString(), new Date(T0).toISOString()])
    // the copy is the server's document as stored, not the one the phone sent
    const stored = await app.copy.get()
    expect(stored.state).toEqual(without(file, HIDDEN))
    expect(stored.rev).toBe(file._rev)
    expect(stored.wid).toBe(file._wid)
    await expectHiddenStayOnServer(app, file, { pushed: true })
  })

  test('a web tab writes in between: the phone pulls, rebases and nothing is lost on either side', async () => {
    const server = await startServer()
    const app = await paired(server)
    const p1 = phone('11111111-1111-4111-8111-111111111111', '2026-11-08')
    await app.workouts.put(p1)
    await app.sync.syncNow()

    const web3 = { id: 'web-3', d: '2026-11-09', name: 'Legs', start: T0, end: T0 + 1, vol: 0, prs: [], entries: [], _ts: T0 }
    await server.webAdds(web3)
    const p2 = phone('22222222-2222-4222-8222-222222222222', '2026-11-09')
    await app.workouts.put(p2)
    expect(await app.sync.syncNow()).toMatchObject({ state: 'idle', pending: 0 })

    const file = server.file()
    expectOriginalKept(file)
    expectOnce(file, p1)
    expectOnce(file, p2)
    expect(file.workouts.filter(w => w.id === 'web-3')).toEqual([web3])
    expect(file.workouts).toHaveLength(5)
    expect((await app.copy.get()).state).toEqual(without(file, HIDDEN))
    await expectHiddenStayOnServer(app, file, { pushed: true })
  })

  test('a typed weigh-in reaches the server file, and a later typed remove takes it out and stamps the day', async () => {
    const server = await startServer()
    const app = await paired(server)
    await app.weighIns.put({ d: '2026-11-08', op: 'set', w: 181.2, t: T0 })
    expect(await app.sync.syncNow()).toMatchObject({ state: 'idle', pending: 0, pendingWeighIns: 0 })
    let file = server.file()
    expect(file.bodyweight.filter(e => e.d === '2026-11-08')).toEqual([{ d: '2026-11-08', w: 181.2, t: T0 }])
    expectOriginalKept(file)
    expect(file.workouts.map(stripStamps)).toEqual(fixture().workouts.map(stripStamps))
    expect((await app.copy.get()).state.bodyweight).toEqual(file.bodyweight)

    await app.weighIns.put({ d: '2026-11-08', op: 'remove', t: T0 + 1000, baseT: T0 })
    expect(await app.sync.syncNow()).toMatchObject({ state: 'idle', pendingWeighIns: 0 })
    file = server.file()
    expect(file.bodyweight ?? []).toEqual([])
    expect(Number(file.deleted.bodyweight['2026-11-08'])).toBeGreaterThan(0)
    expect(file.deleted.workouts).toEqual(fixture().deleted.workouts)
  })

  test('a web weigh-in between the pull and the push survives, and a Health set for its day is dropped', async () => {
    const server = await startServer()
    const plain = createApiClient({ fetch: globalThis.fetch, timeoutMs: 10_000 })
    let raced = false
    const client = {
      ...plain,
      async push(...args) {
        if (!raced) {
          raced = true
          await server.webWeighs({ d: '2026-11-08', w: 182, t: T0 - 500 })
          await server.webWeighs({ d: '2026-11-06', w: 183, t: T0 - 400 })
        }
        return plain.push(...args)
      },
    }
    const app = await paired(server, undefined, { client })
    await app.weighIns.put({ d: '2026-11-08', op: 'set', w: 175, t: T0, src: 'health', hk: 'H1' })
    await app.weighIns.put({ d: '2026-11-09', op: 'set', w: 181, t: T0 })
    expect(await app.sync.syncNow()).toMatchObject({ state: 'idle', pendingWeighIns: 0 })
    const byDay = Object.fromEntries(server.file().bodyweight.map(e => [e.d, e]))
    expect(byDay['2026-11-08']).toMatchObject({ w: 182, t: T0 - 500 })
    expect(byDay['2026-11-08']).not.toHaveProperty('src')
    expect(byDay['2026-11-06']).toMatchObject({ w: 183 })
    expect(byDay['2026-11-09']).toMatchObject({ w: 181, t: T0 })
  })

  test('the web edits an imported day in place between the pull and the push: a Health op naming the old entry is dropped', async () => {
    const server = await startServer()
    const plain = createApiClient({ fetch: globalThis.fetch, timeoutMs: 10_000 })
    let race = false
    const client = {
      ...plain,
      async push(...args) {
        if (race) {
          race = false
          // The web's weight sheet edits today's entry in place: ex.w = n; ex.t = Date.now().
          const cookie = webCookie()
          const got = await (await fetch(`${server.api}/api/data`, { headers: cookie })).json()
          const bodyweight = got.state.bodyweight.map(e => (e.d === '2026-11-08' ? { ...e, w: 182, t: T0 + 500 } : e))
          const res = await fetch(`${server.api}/api/data`, {
            method: 'PUT',
            headers: { ...cookie, 'Content-Type': 'application/json' },
            body: JSON.stringify({ state: { ...got.state, bodyweight }, baseRev: got.rev, baseWid: got.state._wid, stamped: true }),
          })
          expect(res.status).toBe(200)
        }
        return plain.push(...args)
      },
    }
    const app = await paired(server, undefined, { client })
    await app.weighIns.put({ d: '2026-11-08', op: 'set', w: 185, t: T0, src: 'health', hk: 'X' })
    expect(await app.sync.syncNow()).toMatchObject({ state: 'idle', pendingWeighIns: 0 })
    expect(server.file().bodyweight.find(e => e.d === '2026-11-08')).toEqual({ d: '2026-11-08', w: 185, t: T0, src: 'health', hk: 'X' })

    race = true
    await app.weighIns.put({ d: '2026-11-08', op: 'remove', t: T0 + 1000, src: 'health', baseT: T0 })
    expect(await app.sync.syncNow()).toMatchObject({ state: 'idle', pendingWeighIns: 0 })
    const kept = { d: '2026-11-08', w: 182, t: T0 + 500, src: 'health', hk: 'X' }
    expect(server.file().bodyweight.find(e => e.d === '2026-11-08')).toEqual(kept)
    await app.weighIns.put({ d: '2026-11-08', op: 'set', w: 186, t: T0 + 2000, src: 'health', hk: 'Y', baseT: T0 })
    expect(await app.sync.syncNow()).toMatchObject({ state: 'idle', pendingWeighIns: 0 })
    expect(server.file().bodyweight.find(e => e.d === '2026-11-08')).toEqual(kept)
    expect((await app.copy.get()).state.bodyweight.find(e => e.d === '2026-11-08')).toEqual(kept)
  })

  test('a day deleted on the web stays deleted after the phone forgets and pairs again', async () => {
    const server = await startServer()
    const app = await paired(server)
    await app.weighIns.put({ d: '2026-11-08', op: 'set', w: 181.2, t: T0 })
    await app.sync.syncNow()
    expect(server.file().bodyweight).toHaveLength(1)
    const cookie = webCookie()
    const got = await (await fetch(`${server.api}/api/data`, { headers: cookie })).json()
    const del = Math.max(Date.now(), T0 + 60_000)
    const state = { ...got.state, bodyweight: [], deleted: { ...got.state.deleted, bodyweight: { '2026-11-08': del } } }
    const res = await fetch(`${server.api}/api/data`, { method: 'PUT', headers: { ...cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ state, baseRev: got.rev, baseWid: got.state._wid, stamped: true }) })
    expect(res.status).toBe(200)
    await app.sync.forget()
    expect(await app.sync.pair(server.api, await server.pairCode())).toEqual({ ok: true })
    const file = server.file()
    expect(file.bodyweight ?? []).toEqual([])
    expect(Number(file.deleted.bodyweight['2026-11-08'])).toBeGreaterThan(0)
    expect(await app.weighIns.listPending()).toEqual([])
  })

  // A routine whose first slot carries keys this app does not know, as the web leaves them.
  const planned = () => ({
    ...fixture(),
    routines: [
      {
        id: 'r1', name: 'Push', _ts: 1730000000000,
        ex: [
          { id: '0025', sets: 3, reps: 5, mode: 'reps', weight: 60, prog: 'linear', pyramid: [{ w: 60, r: 8 }, { w: 70, r: 5 }], futureSlotKey: { nested: [1, { x: 'y' }] } },
          { id: '0027', sets: 3, reps: 8, mode: 'reps' },
        ],
      },
      fixture().routines[1],
    ],
  })
  // What the Plan screen saves: the copy's routine with its slots swapped and one edited.
  const swappedEdit = base => ({
    rid: base.id, baseTs: base._ts, t: T0,
    routine: { ...base, ex: [{ ...base.ex[1], sets: 4 }, base.ex[0]] },
  })
  const content = r => without(r, ['_ts', '_f', '_u'])

  test('a routine edit with its slots swapped reaches the server file with each key on its own slot and a new _ts; the pull acks it', async () => {
    const server = await startServer({ state: planned() })
    const app = await paired(server)
    const base = (await app.copy.get()).state.routines[0]
    const mine = swappedEdit(base)
    await app.routineEdits.put(mine)
    expect(await app.sync.status()).toMatchObject({ pendingRoutineEdits: 1 })

    expect(await app.sync.syncNow()).toMatchObject({ state: 'idle', pendingRoutineEdits: 0 })
    const file = server.file()
    const stored = file.routines.find(r => r.id === 'r1')
    expect(content(stored)).toEqual(content(mine.routine))
    expect(stored.ex[1]).toEqual(planned().routines[0].ex[0]) // the unknown key moved with its slot
    expect(stored.ex[0]).toEqual({ ...planned().routines[0].ex[1], sets: 4 })
    expect(stored._ts).toBeGreaterThan(planned().routines[0]._ts)
    expect(file.routines[1]).toEqual(planned().routines[1])
    expect(file.workouts).toEqual(fixture().workouts)
    expect(file.queue).toEqual(fixture().queue)
    expect((await app.copy.get()).state).toEqual(without(file, HIDDEN))
    expect(await app.routineEdits.listPending()).toEqual([])
    expect(await app.db.getAll('SELECT rid, acked_at, superseded_at FROM routine_edits')).toEqual([{ rid: 'r1', acked_at: new Date(T0).toISOString(), superseded_at: null }])
    expect(await app.routineEdits.listNotices()).toEqual([])
  })

  test('the web edits that routine between the pull and the push: a real 409, the phone\'s edit is superseded and never sent again', async () => {
    const server = await startServer({ state: planned() })
    const plain = createApiClient({ fetch: globalThis.fetch, timeoutMs: 10_000 })
    let race = false
    const pushes = []
    const client = {
      ...plain,
      async push(...args) {
        if (race) {
          race = false
          const cookie = webCookie()
          const got = await (await fetch(`${server.api}/api/data`, { headers: cookie })).json()
          const routines = got.state.routines.map(r => (r.id === 'r1' ? { ...r, name: 'Push A', _ts: T0 + 500 } : r))
          const res = await fetch(`${server.api}/api/data`, {
            method: 'PUT',
            headers: { ...cookie, 'Content-Type': 'application/json' },
            body: JSON.stringify({ state: { ...got.state, routines }, baseRev: got.rev, baseWid: got.state._wid, stamped: true }),
          })
          expect(res.status).toBe(200)
        }
        const r = await plain.push(...args)
        pushes.push(r.ok ? 200 : r.kind)
        return r
      },
    }
    const app = await paired(server, undefined, { client })
    await app.routineEdits.put(swappedEdit((await app.copy.get()).state.routines[0]))
    race = true
    expect(await app.sync.syncNow()).toMatchObject({ state: 'idle', pendingRoutineEdits: 0 })
    expect(pushes).toEqual(['conflict'])
    const stored = server.file().routines.find(r => r.id === 'r1')
    expect(content(stored)).toEqual({ ...content(planned().routines[0]), name: 'Push A' })
    expect(stored._ts).toBe(T0 + 500)
    expect(await app.routineEdits.listPending()).toEqual([])
    expect(await app.routineEdits.listNotices()).toEqual([{ rid: 'r1', name: 'Push', kind: 'changed', at: new Date(T0).toISOString() }])

    expect(await app.sync.syncNow()).toMatchObject({ state: 'idle', pendingRoutineEdits: 0 })
    expect(pushes).toEqual(['conflict'])
    expect(server.file().routines.find(r => r.id === 'r1')).toEqual(stored)
  })

  test('a routine holding the same exercise twice: a sets-only edit round-trips exactly; a move is never sent', async () => {
    const twins = {
      id: 'r3', name: 'Bench day', _ts: 1730000000000,
      ex: [
        { id: '0025', sets: 3, reps: 5, mode: 'reps', weight: 60, pyramid: [{ w: 60, r: 8 }, { w: 70, r: 5 }], stationId: 'rack-2' },
        { id: '0025', sets: 3, reps: 10, mode: 'reps', weight: 45 },
      ],
    }
    const server = await startServer({ state: { ...fixture(), routines: [...fixture().routines, twins] } })
    const app = await paired(server)
    const base = (await app.copy.get()).state.routines.find(r => r.id === 'r3')
    const setsOnly = { ...base, ex: [base.ex[0], { ...base.ex[1], sets: 4 }] }
    await app.routineEdits.put({ rid: 'r3', baseTs: base._ts, routine: setsOnly, t: T0 })
    expect(await app.sync.syncNow()).toMatchObject({ state: 'idle', pendingRoutineEdits: 0 })
    let stored = server.file().routines.find(r => r.id === 'r3')
    expect(stored.ex).toEqual(setsOnly.ex) // each twin keeps its own keys
    expect(stored._ts).toBeGreaterThan(twins._ts)
    expect(await app.routineEdits.listNotices()).toEqual([])

    const now = (await app.copy.get()).state.routines.find(r => r.id === 'r3')
    await app.routineEdits.put({ rid: 'r3', baseTs: now._ts, routine: { ...now, ex: [now.ex[1], now.ex[0]] }, t: T0 + 1 })
    const before = server.file()
    expect(await app.sync.syncNow()).toMatchObject({ state: 'idle', pendingRoutineEdits: 0 })
    expect(server.file()).toEqual(before)
    expect(await app.routineEdits.listNotices()).toEqual([{ rid: 'r3', name: 'Bench day', kind: 'unsafe', at: new Date(T0).toISOString() }])
  })

  test('a cross-swap the API would put keys back into is never sent: nothing stored, an unsafe notice', async () => {
    const server = await startServer({ state: planned() })
    const plain = createApiClient({ fetch: globalThis.fetch, timeoutMs: 10_000 })
    const pushes = []
    const client = { ...plain, async push(...args) { const r = await plain.push(...args); pushes.push(r.ok ? 200 : r.kind); return r } }
    const app = await paired(server, undefined, { client })
    const base = (await app.copy.get()).state.routines[0]
    // the second slot becomes the first slot's exercise while the first becomes another: no id twice
    const { pyramid, futureSlotKey, ...firstRest } = base.ex[0]
    const cross = { ...base, ex: [{ ...firstRest, id: '0047', weight: 0 }, { ...base.ex[1], id: base.ex[0].id }] }
    await app.routineEdits.put({ rid: 'r1', baseTs: base._ts, routine: cross, t: T0 })
    const before = server.file()
    expect(await app.sync.syncNow()).toMatchObject({ state: 'idle', pendingRoutineEdits: 0 })
    expect(pushes).toEqual([])
    expect(server.file()).toEqual(before)
    expect(await app.routineEdits.listNotices()).toEqual([{ rid: 'r1', name: 'Push', kind: 'unsafe', at: new Date(T0).toISOString() }])
  })

  test('an edit during the push, a web settings write, then a revert rebased on the landed push: stored as sent, acked, no loop', async () => {
    const server = await startServer({ state: planned() })
    const plain = createApiClient({ fetch: globalThis.fetch, timeoutMs: 10_000 })
    const pushes = []
    let during = null
    const client = {
      ...plain,
      async push(...args) {
        const r = await plain.push(...args)
        pushes.push(r.ok ? 200 : r.kind)
        if (during) { const go = during; during = null; await go() }
        return r
      },
    }
    const app = await paired(server, undefined, { client })
    const base = (await app.copy.get()).state.routines[0]
    const setsTo = n => ({ ...base, ex: [{ ...base.ex[0], sets: n }, base.ex[1]] })
    await app.routineEdits.put({ rid: 'r1', baseTs: base._ts, routine: setsTo(4), t: T0 })
    during = async () => {
      // the owner puts it back to 3 on the copy they still see; then a web tab changes a setting
      await app.routineEdits.put({ rid: 'r1', baseTs: base._ts, routine: setsTo(3), t: T0 + 1 })
      const cookie = webCookie()
      const got = await (await fetch(`${server.api}/api/data`, { headers: cookie })).json()
      const state = { ...got.state, lang: 'de', edited: { ...got.state.edited, lang: T0 + 700 } }
      const res = await fetch(`${server.api}/api/data`, { method: 'PUT', headers: { ...cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ state, baseRev: got.rev, baseWid: got.state._wid, stamped: true }) })
      expect(res.status).toBe(200)
    }
    expect(await app.sync.syncNow()).toMatchObject({ state: 'idle', pendingRoutineEdits: 1 })
    expect(server.file().routines[0].ex[0].sets).toBe(4)
    expect(server.file().lang).toBe('de')

    expect(await app.sync.syncNow()).toMatchObject({ state: 'idle', pendingRoutineEdits: 0 })
    const stored = server.file().routines[0]
    expect(content(stored)).toEqual(content(setsTo(3)))
    expect(await app.routineEdits.listNotices()).toEqual([])
    expect(await app.routineEdits.listPending()).toEqual([])
    expect(await app.sync.syncNow()).toMatchObject({ state: 'idle', pendingRoutineEdits: 0 })
    expect(pushes).toEqual([200, 200])
    expect(server.file().routines[0]).toEqual(stored)
  })

  test('a new profile with no document yet: pairing pulls an empty one and the first push starts it', async () => {
    const server = await startServer({ state: null })
    const app = await paired(server)
    expect(await app.copy.get()).toMatchObject({ state: {}, rev: 0, wid: null })
    const p1 = phone('11111111-1111-4111-8111-111111111111', '2026-11-08')
    await app.workouts.put(p1)
    expect(await app.sync.syncNow()).toMatchObject({ state: 'idle', pending: 0 })
    const file = server.file()
    expect(file.workouts.map(stripStamps)).toEqual([p1])
    expect(file._rev).toBe(1)
    expect(file.unit).toBe('lb')
    expect((await app.copy.get()).state).toEqual(without(file, HIDDEN))
  })

  test('a profile kept in kilograms is refused: no token, copy or address is kept, the file untouched', async () => {
    const server = await startServer({ state: { ...fixture(), unit: 'kg' } })
    const app = phoneApp(createRealDb())
    expect(await app.sync.pair(server.api, await server.pairCode()))
      .toEqual({ ok: false, error: 'This profile uses kilograms. The app works in pounds for now, so it was not paired.' })
    expect(app.keychain.m.size).toBe(0)
    expect(await app.copy.get()).toBeNull()
    expect(await app.meta.get('server')).toBeNull()
    expect(server.file()).toEqual({ ...fixture(), unit: 'kg' })
  })

  test('a web write lands between the pull and the push: a real 409, one retry, nothing lost', async () => {
    const server = await startServer()
    const plain = createApiClient({ fetch: globalThis.fetch, timeoutMs: 10_000 })
    let raced = false
    const client = {
      ...plain,
      async push(...args) {
        if (!raced) {
          raced = true
          await server.webAdds({ id: 'web-race', d: '2026-11-09', name: 'Row', start: T0, end: T0 + 1, vol: 0, prs: [], entries: [], _ts: T0 })
        }
        return plain.push(...args)
      },
    }
    const pushes = []
    const watched = { ...client, async push(base, token, body) { const r = await client.push(base, token, body); pushes.push(r.ok ? 200 : r.kind); return r } }
    const app = await paired(server, undefined, { client: watched })
    const p1 = phone('11111111-1111-4111-8111-111111111111', '2026-11-08')
    await app.workouts.put(p1)
    expect(await app.sync.syncNow()).toMatchObject({ state: 'idle', pending: 0 })
    expect(pushes).toEqual(['conflict', 200])

    const file = server.file()
    expectOriginalKept(file)
    expectOnce(file, p1)
    expect(file.workouts.filter(w => w.id === 'web-race')).toHaveLength(1)
    expect(file.workouts).toHaveLength(4)
  })

  test('killed between the 200 and markAcked: the next sync adds no duplicate and acks the row', async () => {
    const server = await startServer()
    const keychain = fakeKeychain()
    const plain = createApiClient({ fetch: globalThis.fetch, timeoutMs: 10_000 })
    let landed
    const pushed = new Promise(resolve => { landed = resolve })
    // The PUT reaches the server and is answered; then the app dies before it acts on the answer.
    const dying = { ...plain, async push(...args) { await plain.push(...args); landed(); return new Promise(() => {}) } }
    let db = createRealDb()
    const first = await paired(server, db, { keychain, client: dying })
    const p1 = phone('11111111-1111-4111-8111-111111111111', '2026-11-08')
    await first.workouts.put(p1)
    first.sync.syncNow()
    await pushed
    expect(server.file().workouts.filter(w => w.id === p1.id)).toHaveLength(1)
    expect((await first.workouts.listPending()).map(w => w.id)).toEqual([p1.id])

    db = db.reopen()
    const second = phoneApp(db, { keychain })
    expect((await second.workouts.listPending()).map(w => w.id)).toEqual([p1.id])
    expect(await second.sync.syncNow()).toMatchObject({ state: 'idle', pending: 0 })
    const file = server.file()
    expectOnce(file, p1)
    expect(file.workouts).toHaveLength(3)
    expect(await db.getAll('SELECT acked_at FROM finished_workouts WHERE id = ?', [p1.id])).toEqual([{ acked_at: new Date(T0).toISOString() }])
  })

  test('sign out everywhere: the next sync is unpaired and every workout stays', async () => {
    const server = await startServer()
    const app = await paired(server)
    const p1 = phone('11111111-1111-4111-8111-111111111111', '2026-11-08')
    await app.workouts.put(p1)
    await app.sync.syncNow()
    const p2 = phone('22222222-2222-4222-8222-222222222222', '2026-11-09')
    await app.workouts.put(p2)
    const before = await app.copy.get()

    const out = await fetch(`${server.api}/api/logout/all`, { method: 'POST', headers: webCookie() })
    expect(out.status).toBe(200)
    const r = await app.sync.syncNow()
    expect(r).toMatchObject({ paired: false, state: 'unpaired', problem: 'unpaired', pending: 1 })
    expect(app.keychain.m.size).toBe(0)
    expect((await app.workouts.list()).map(w => w.id)).toEqual([p1.id, p2.id])
    expect(await app.copy.get()).toEqual(before)
    expect(server.file().workouts.some(w => w.id === p2.id)).toBe(false)
  })
})
