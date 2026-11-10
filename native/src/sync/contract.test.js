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
import { createSqliteMeasurements } from '../body/measurement-store.js'
import { ROUTINE_DELETED } from './edit-guard.js'
import { createSqlitePendingEdits } from './pending-edits.js'
import { createSqliteFinishedWorkouts } from '../session/finished-workouts.js'
import { createApiClient } from './api-client.js'
import { createCredentials } from './credentials.js'
import { createSqliteServerCopy, createSqliteSyncMeta } from './server-copy.js'
import { createSync } from './sync-engine.js'
import { createSqliteWhoopCache } from '../whoop/whoop-cache.js'
import { createWhoopSource, isServerLink } from '../whoop/whoop-source.js'

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

// `state: null` starts a profile with no document at all, as a new one is. `env` adds settings.
async function startServer({ state = fixture(), env = {} } = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'opengym-contract-'))
  writeFileSync(join(dataDir, 'secret'), SECRET, { mode: 0o600 })
  writeFileSync(join(dataDir, 'db.json'), JSON.stringify({ users: [{ id: UID, name: 'Owner', created: new Date(T0).toISOString() }], creds: [], subs: [], invites: [] }))
  if (state) writeFileSync(join(dataDir, `state-${UID}.json`), JSON.stringify(state))
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost', ...env },
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
    // The same for any other change a web tab makes, which stamps its own edits.
    async webWrites(change) {
      const cookie = webCookie()
      const got = await (await fetch(`${api}/api/data`, { headers: cookie })).json()
      const res = await fetch(`${api}/api/data`, {
        method: 'PUT',
        headers: { ...cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: change(got.state), baseRev: got.rev, baseWid: got.state._wid, stamped: true }),
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
  const edits = createSqlitePendingEdits(db)
  const measurements = createSqliteMeasurements(db)
  const whoopCache = createSqliteWhoopCache(db)
  const sync = createSync({ client, credentials: createCredentials(keychain), copy, workouts, weighIns, edits, measurements, whoopCache, meta, now: () => T0 })
  return { sync, workouts, weighIns, edits, measurements, whoopCache, copy, meta, keychain, client }
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
      paired: true, state: 'idle', lastSyncedAt: new Date(T0).toISOString(), pending: 0, pendingWeighIns: 0, pendingEdits: 0, pendingMeasurements: 0, copyKey: `${stored.rev}|${stored.wid}`, server: server.api, profile: 'Owner',
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

  // A day's measurements as the web stores them: cm that are not round in inches, an empty field,
  // a custom field and a key this app does not know.
  const measured = (d, t, fields = {}) => ({ d, t, neck: 38.1, waist: 81.28, chest: null, other: [{ id: 'c1', name: 'Calf pump', value: 38.5 }], futureKey: { nested: [1, { x: 'y' }] }, ...fields })

  test('a measurement set reaches the server file byte for byte, other days kept; a later remove takes it out and stamps the day', async () => {
    const webDay = measured('2026-11-01', T0 - 9000, { waist: 82.55 })
    const server = await startServer({ state: { ...fixture(), measurements: [webDay] } })
    const app = await paired(server)
    const mine = measured('2026-11-08', T0)
    await app.measurements.put({ d: mine.d, op: 'set', entry: mine, t: T0 })
    expect(await app.sync.syncNow()).toMatchObject({ state: 'idle', pending: 0, pendingMeasurements: 0 })
    let file = server.file()
    expect(JSON.stringify(file.measurements)).toBe(JSON.stringify([webDay, mine]))
    expectOriginalKept(file)
    expect(file.workouts.map(stripStamps)).toEqual(fixture().workouts.map(stripStamps))
    expect((await app.copy.get()).state.measurements).toEqual(file.measurements)
    expect(await app.measurements.listPending()).toEqual([])
    // acked by the pull: the next sync sends nothing
    await app.sync.syncNow()
    expect(server.file()._rev).toBe(file._rev)

    await app.measurements.put({ d: mine.d, op: 'remove', t: T0 + 1000, baseT: T0 })
    expect(await app.sync.syncNow()).toMatchObject({ state: 'idle', pendingMeasurements: 0 })
    file = server.file()
    expect(JSON.stringify(file.measurements)).toBe(JSON.stringify([webDay]))
    expect(Number(file.deleted.measurements['2026-11-08'])).toBeGreaterThan(T0)
    expect(file.deleted.workouts).toEqual(fixture().deleted.workouts)
    expect(await app.measurements.listPending()).toEqual([])
  })

  test('a measurement day the web deletes, and one the phone removes, stay deleted after the phone forgets and pairs again', async () => {
    const server = await startServer()
    const app = await paired(server)
    const a = measured('2026-11-07', T0)
    const b = measured('2026-11-08', T0)
    await app.measurements.put({ d: a.d, op: 'set', entry: a, t: T0 })
    await app.measurements.put({ d: b.d, op: 'set', entry: b, t: T0 })
    await app.sync.syncNow()
    expect(server.file().measurements).toEqual([a, b])
    // the phone removes one day; the web deletes the other, as its Delete button does
    await app.measurements.put({ d: b.d, op: 'remove', t: T0 + 1000, baseT: T0 })
    expect(await app.sync.syncNow()).toMatchObject({ state: 'idle', pendingMeasurements: 0 })
    const del = Math.max(Date.now(), T0 + 60_000)
    await server.webWrites(state => ({ ...state, measurements: [], deleted: { ...state.deleted, measurements: { ...state.deleted.measurements, [a.d]: del } } }))
    const file = server.file()
    expect(file.measurements).toEqual([])
    await app.sync.forget()
    expect(await app.sync.status()).toMatchObject({ pendingMeasurements: 2 })
    expect(await app.sync.pair(server.api, await server.pairCode())).toEqual({ ok: true })
    const after = server.file()
    expect(after._rev).toBe(file._rev) // nothing was pushed
    expect(after.measurements).toEqual([])
    expect(Number(after.deleted.measurements[a.d])).toBe(del)
    expect(Number(after.deleted.measurements[b.d])).toBeGreaterThan(T0)
    expect(await app.measurements.listPending()).toEqual([])
    expect((await app.copy.get()).state.measurements).toEqual([])
  })

  // Fix round 1: the delete names the copy's entry for the day, here none; the store adds the
  // phone's own set times, so the set that landed while its pull failed is taken out.
  test('push ok, pull failed, then the owner deletes the day: the next sync removes it from the server file for good', async () => {
    const server = await startServer()
    const plain = createApiClient({ fetch: globalThis.fetch, timeoutMs: 10_000 })
    let failPull = false
    const client = {
      ...plain,
      async pull(...args) {
        if (failPull) {
          failPull = false
          return { ok: false, kind: 'offline' }
        }
        return plain.pull(...args)
      },
    }
    const app = await paired(server, undefined, { client })
    const mine = measured('2026-11-08', T0)
    await app.measurements.put({ d: mine.d, op: 'set', entry: mine, t: T0 })
    failPull = true
    expect(await app.sync.syncNow()).toMatchObject({ state: 'waiting', pendingMeasurements: 1 })
    expect(server.file().measurements).toEqual([mine])
    expect((await app.copy.get()).state).not.toHaveProperty('measurements')
    await app.measurements.put({ d: mine.d, op: 'remove', t: T0 + 1000 })
    expect(await app.sync.syncNow()).toMatchObject({ state: 'idle', pendingMeasurements: 0 })
    const file = server.file()
    expect(file.measurements).toEqual([])
    expect(Number(file.deleted.measurements[mine.d])).toBeGreaterThan(T0)
    expect((await app.copy.get()).state.measurements).toEqual([])
    expect(await app.measurements.listPending()).toEqual([])
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
    kind: 'routine', key: base.id, baseTs: base._ts, t: T0,
    value: { ...base, ex: [{ ...base.ex[1], sets: 4 }, base.ex[0]] },
  })
  const content = r => without(r, ['_ts', '_f', '_u'])

  test('a routine edit with its slots swapped reaches the server file with each key on its own slot and a new _ts; the pull acks it', async () => {
    const server = await startServer({ state: planned() })
    const app = await paired(server)
    const base = (await app.copy.get()).state.routines[0]
    const mine = swappedEdit(base)
    await app.edits.put(mine)
    expect(await app.sync.status()).toMatchObject({ pendingEdits: 1 })

    expect(await app.sync.syncNow()).toMatchObject({ state: 'idle', pendingEdits: 0 })
    const file = server.file()
    const stored = file.routines.find(r => r.id === 'r1')
    expect(content(stored)).toEqual(content(mine.value))
    expect(stored.ex[1]).toEqual(planned().routines[0].ex[0]) // the unknown key moved with its slot
    expect(stored.ex[0]).toEqual({ ...planned().routines[0].ex[1], sets: 4 })
    expect(stored._ts).toBeGreaterThan(planned().routines[0]._ts)
    expect(file.routines[1]).toEqual(planned().routines[1])
    expect(file.workouts).toEqual(fixture().workouts)
    expect(file.queue).toEqual(fixture().queue)
    expect((await app.copy.get()).state).toEqual(without(file, HIDDEN))
    expect(await app.edits.listPending()).toEqual([])
    expect(await app.db.getAll('SELECT key, acked_at, superseded_at FROM pending_edits')).toEqual([{ key: 'r1', acked_at: new Date(T0).toISOString(), superseded_at: null }])
    expect(await app.edits.listNotices()).toEqual([])
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
    await app.edits.put(swappedEdit((await app.copy.get()).state.routines[0]))
    race = true
    expect(await app.sync.syncNow()).toMatchObject({ state: 'idle', pendingEdits: 0 })
    expect(pushes).toEqual(['conflict'])
    const stored = server.file().routines.find(r => r.id === 'r1')
    expect(content(stored)).toEqual({ ...content(planned().routines[0]), name: 'Push A' })
    expect(stored._ts).toBe(T0 + 500)
    expect(await app.edits.listPending()).toEqual([])
    expect(await app.edits.listNotices()).toEqual([{ kind: 'routine', key: 'r1', name: 'Push', reason: 'changed', at: new Date(T0).toISOString() }])

    expect(await app.sync.syncNow()).toMatchObject({ state: 'idle', pendingEdits: 0 })
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
    await app.edits.put({ kind: 'routine', key: 'r3', baseTs: base._ts, value: setsOnly, t: T0 })
    expect(await app.sync.syncNow()).toMatchObject({ state: 'idle', pendingEdits: 0 })
    let stored = server.file().routines.find(r => r.id === 'r3')
    expect(stored.ex).toEqual(setsOnly.ex) // each twin keeps its own keys
    expect(stored._ts).toBeGreaterThan(twins._ts)
    expect(await app.edits.listNotices()).toEqual([])

    const now = (await app.copy.get()).state.routines.find(r => r.id === 'r3')
    await app.edits.put({ kind: 'routine', key: 'r3', baseTs: now._ts, value: { ...now, ex: [now.ex[1], now.ex[0]] }, t: T0 + 1 })
    const before = server.file()
    expect(await app.sync.syncNow()).toMatchObject({ state: 'idle', pendingEdits: 0 })
    expect(server.file()).toEqual(before)
    expect(await app.edits.listNotices()).toEqual([{ kind: 'routine', key: 'r3', name: 'Bench day', reason: 'unsafe', at: new Date(T0).toISOString() }])
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
    await app.edits.put({ kind: 'routine', key: 'r1', baseTs: base._ts, value: cross, t: T0 })
    const before = server.file()
    expect(await app.sync.syncNow()).toMatchObject({ state: 'idle', pendingEdits: 0 })
    expect(pushes).toEqual([])
    expect(server.file()).toEqual(before)
    expect(await app.edits.listNotices()).toEqual([{ kind: 'routine', key: 'r1', name: 'Push', reason: 'unsafe', at: new Date(T0).toISOString() }])
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
    await app.edits.put({ kind: 'routine', key: 'r1', baseTs: base._ts, value: setsTo(4), t: T0 })
    during = async () => {
      // the owner puts it back to 3 on the copy they still see; then a web tab changes a setting
      await app.edits.put({ kind: 'routine', key: 'r1', baseTs: base._ts, value: setsTo(3), t: T0 + 1 })
      const cookie = webCookie()
      const got = await (await fetch(`${server.api}/api/data`, { headers: cookie })).json()
      const state = { ...got.state, lang: 'de', edited: { ...got.state.edited, lang: T0 + 700 } }
      const res = await fetch(`${server.api}/api/data`, { method: 'PUT', headers: { ...cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ state, baseRev: got.rev, baseWid: got.state._wid, stamped: true }) })
      expect(res.status).toBe(200)
    }
    expect(await app.sync.syncNow()).toMatchObject({ state: 'idle', pendingEdits: 1 })
    expect(server.file().routines[0].ex[0].sets).toBe(4)
    expect(server.file().lang).toBe('de')

    expect(await app.sync.syncNow()).toMatchObject({ state: 'idle', pendingEdits: 0 })
    const stored = server.file().routines[0]
    expect(content(stored)).toEqual(content(setsTo(3)))
    expect(await app.edits.listNotices()).toEqual([])
    expect(await app.edits.listPending()).toEqual([])
    expect(await app.sync.syncNow()).toMatchObject({ state: 'idle', pendingEdits: 0 })
    expect(pushes).toEqual([200, 200])
    expect(server.file().routines[0]).toEqual(stored)
  })

  // Creating and deleting a routine (7E-A): a create is a routine row on base 0, a delete a routine
  // row holding ROUTINE_DELETED on the routine's _ts. The server stamps a new routine's _ts and
  // records a routine the push lacks in deleted.routines (sync-stamps.js stampUnstamped).
  const LEGS = { id: 'r9', name: 'Legs', ex: [{ id: '0031', sets: 3, reps: 8, mode: 'reps' }] }
  const AT = new Date(T0).toISOString()
  const counted = (server, before = null) => {
    const plain = createApiClient({ fetch: globalThis.fetch, timeoutMs: 10_000 })
    const pushes = []
    const client = { ...plain, async push(...args) { if (before) { const go = before; before = null; await go(server) } const r = await plain.push(...args); pushes.push(r.ok ? 200 : r.kind); return r } }
    return { client, pushes }
  }

  test('a phone create reaches the server file at the end of routines, and the server stamps its _ts; the pull acks it', async () => {
    const server = await startServer({ state: planned() })
    const app = await paired(server)
    await app.edits.put({ kind: 'routine', key: 'r9', baseTs: 0, value: LEGS, t: T0 })
    expect(await app.sync.syncNow()).toMatchObject({ state: 'idle', pendingEdits: 0 })
    const file = server.file()
    expect(file.routines.slice(0, 2)).toEqual(planned().routines)
    expect(content(file.routines[2])).toEqual(LEGS)
    expect(file.routines[2]._ts).toBeGreaterThan(planned().routines[0]._ts)
    expect(file.routines).toHaveLength(3)
    for (const k of ['queue', 'deleted', 'edited', 'workouts']) expect(file[k], k).toEqual(planned()[k])
    expect((await app.copy.get()).state).toEqual(without(file, HIDDEN))
    expect(await app.db.getAll('SELECT key, acked_at, superseded_at FROM pending_edits')).toEqual([{ key: 'r9', acked_at: AT, superseded_at: null }])
    expect(await app.edits.listNotices()).toEqual([])
  })

  test('a phone delete takes the routine and its week and dayPlan places out of the server file, which records it in deleted.routines; a later pull does not bring it back', async () => {
    const server = await startServer({ state: { ...planned(), week: { 1: ['r1', 'r2'], 4: ['r1'] }, dayPlan: { '2026-11-12': 'r1', '2026-11-13': 'r2' } } })
    const { client, pushes } = counted(server)
    const app = await paired(server, undefined, { client })
    const base = (await app.copy.get()).state.routines[0]
    await app.edits.put({ kind: 'routine', key: 'r1', baseTs: base._ts, value: ROUTINE_DELETED, t: T0 })
    expect(await app.sync.syncNow()).toMatchObject({ state: 'idle', pendingEdits: 0 })
    const file = server.file()
    expect(file.routines).toEqual([planned().routines[1]])
    expect(file.deleted.routines.r1).toBeGreaterThan(base._ts)
    expect(file.week).toEqual({ 1: ['r2'] })
    expect(file.dayPlan).toEqual({ '2026-11-13': 'r2' })
    expect(file.queue).toEqual(fixture().queue) // its readers skip an id that no longer resolves
    expect(file.workouts).toEqual(fixture().workouts)
    expect(await app.db.getAll('SELECT key, acked_at, superseded_at FROM pending_edits')).toEqual([{ key: 'r1', acked_at: AT, superseded_at: null }])

    // a web write moves the revision: the next sync pulls, and r1 stays gone with nothing sent
    await server.webWrites(state => ({ ...state, lang: 'de', edited: { ...state.edited, lang: T0 + 700 } }))
    expect(await app.sync.syncNow()).toMatchObject({ state: 'idle', pendingEdits: 0 })
    expect((await app.copy.get()).state.routines.map(r => r.id)).toEqual(['r2'])
    expect(server.file().routines.map(r => r.id)).toEqual(['r2'])
    expect(pushes).toEqual([200])
    expect(await app.edits.listNotices()).toEqual([])
  })

  test('a create whose id the server has on record as deleted is superseded as deleted and never sent', async () => {
    const server = await startServer({ state: { ...planned(), deleted: { ...fixture().deleted, routines: { r9: T0 - 1000 } } } })
    const { client, pushes } = counted(server)
    const app = await paired(server, undefined, { client })
    await app.edits.put({ kind: 'routine', key: 'r9', baseTs: 0, value: LEGS, t: T0 })
    const before = server.file()
    expect(await app.sync.syncNow()).toMatchObject({ state: 'idle', pendingEdits: 0 })
    expect(pushes).toEqual([])
    expect(server.file()).toEqual(before)
    expect(await app.edits.listNotices()).toEqual([{ kind: 'routine', key: 'r9', name: 'Legs', reason: 'deleted', at: AT }])
  })

  test('a delete over a real 409 (the web changed that routine first) is superseded as changed and never sent again', async () => {
    const server = await startServer({ state: planned() })
    const webRenames = async ({ api }) => {
      const cookie = webCookie()
      const got = await (await fetch(`${api}/api/data`, { headers: cookie })).json()
      const routines = got.state.routines.map(r => (r.id === 'r1' ? { ...r, name: 'Push A', _ts: T0 + 500 } : r))
      const res = await fetch(`${api}/api/data`, {
        method: 'PUT',
        headers: { ...cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: { ...got.state, routines }, baseRev: got.rev, baseWid: got.state._wid, stamped: true }),
      })
      expect(res.status).toBe(200)
    }
    const { client, pushes } = counted(server, webRenames)
    const app = await paired(server, undefined, { client })
    await app.edits.put({ kind: 'routine', key: 'r1', baseTs: (await app.copy.get()).state.routines[0]._ts, value: ROUTINE_DELETED, t: T0 })
    expect(await app.sync.syncNow()).toMatchObject({ state: 'idle', pendingEdits: 0 })
    expect(pushes).toEqual(['conflict'])
    const stored = server.file().routines.find(r => r.id === 'r1')
    expect(content(stored)).toEqual({ ...content(planned().routines[0]), name: 'Push A' })
    expect(stored._ts).toBe(T0 + 500)
    expect(server.file().deleted).toEqual(fixture().deleted)
    // the marker carries no name: the screen that shows the notice names it from the copy
    expect(await app.edits.listNotices()).toEqual([{ kind: 'routine', key: 'r1', name: '', reason: 'changed', at: AT }])

    expect(await app.sync.syncNow()).toMatchObject({ state: 'idle', pendingEdits: 0 })
    expect(pushes).toEqual(['conflict'])
    expect(server.file().routines.find(r => r.id === 'r1')).toEqual(stored)
  })

  // Nutrition days and the two settings, as the web keeps them: a day stamped by its own _ts, a
  // setting by its stamp in `edited`.
  const nourished = () => ({
    ...fixture(),
    nutritionDays: {
      '2026-11-07': { kcal: 2000, protein: 150, carbs: 200, fat: 60, fiber: 25, dayType: 'rest', supps: ['s1'], futureDayKey: { x: 1 }, _ts: 1730000000000 },
    },
    nutritionTargets: { training: { kcal: 2400, protein: 170, fiber: 30 }, rest: { kcal: 2000, protein: 160, fiber: 30 } },
    supplements: [{ id: 's1', name: 'Creatine' }],
    edited: { ...fixture().edited, nutritionTargets: 1730000000000 },
  })
  const DAY = { kcal: 2100, protein: 160, carbs: 220, fat: 70, fiber: 30, dayType: 'training', note: 'leg day' }
  // What the Nutrition screen saves: a day on the copy day's _ts (null when the copy has none).
  const dayEdit = async (app, d, value, t = T0) => {
    const held = (await app.copy.get()).state.nutritionDays?.[d]
    await app.edits.put({ kind: 'nutritionDay', key: d, baseTs: held?._ts ?? null, value, t })
  }
  const watched = () => {
    const plain = createApiClient({ fetch: globalThis.fetch, timeoutMs: 10_000 })
    const pushes = []
    const client = { ...plain, before: null, async push(...args) { if (client.before) { const go = client.before; client.before = null; await go() } const r = await plain.push(...args); pushes.push(r.ok ? 200 : r.kind); return r } }
    return { client, pushes }
  }
  const editRows = app => app.db.getAll('SELECT kind, key, acked_at, superseded_at FROM pending_edits')

  test('a phone nutrition day reaches the server file with a _ts the server stamps; every other day and key is kept; the pull acks it', async () => {
    const server = await startServer({ state: nourished() })
    const { client, pushes } = watched()
    const app = await paired(server, undefined, { client })
    await dayEdit(app, '2026-11-08', DAY)
    expect(await app.sync.status()).toMatchObject({ pendingEdits: 1 })

    expect(await app.sync.syncNow()).toMatchObject({ state: 'idle', pendingEdits: 0 })
    expect(pushes).toEqual([200])
    const file = server.file()
    expect(without(file.nutritionDays['2026-11-08'], ['_ts'])).toEqual(DAY)
    expect(file.nutritionDays['2026-11-08']._ts).toBeGreaterThan(T0)
    expect(file.nutritionDays['2026-11-07']).toEqual(nourished().nutritionDays['2026-11-07'])
    expect(file.nutritionTargets).toEqual(nourished().nutritionTargets)
    expect(file.supplements).toEqual(nourished().supplements)
    expect(file.edited).toEqual(nourished().edited)
    expect(file.routines).toEqual(fixture().routines)
    expect(file.workouts).toEqual(fixture().workouts)
    expect(file.queue).toEqual(fixture().queue)
    expect((await app.copy.get()).state).toEqual(without(file, HIDDEN))
    expect(await app.edits.listPending()).toEqual([])
    expect(await editRows(app)).toEqual([{ kind: 'nutritionDay', key: '2026-11-08', acked_at: new Date(T0).toISOString(), superseded_at: null }])
    expect(await app.edits.listNotices()).toEqual([])

    expect(await app.sync.syncNow()).toMatchObject({ state: 'idle', pendingEdits: 0 })
    expect(pushes).toEqual([200])
    expect(server.file()).toEqual(file)
  })

  test('a phone targets edit reaches the server file, which moves edited.nutritionTargets; the pull acks it', async () => {
    const server = await startServer({ state: nourished() })
    const { client, pushes } = watched()
    const app = await paired(server, undefined, { client })
    const targets = { training: { kcal: 2600, protein: 180, fiber: 32 }, rest: { kcal: 2000, protein: 160, fiber: 30 } }
    const base = (await app.copy.get()).state.edited.nutritionTargets
    await app.edits.put({ kind: 'setting', key: 'nutritionTargets', baseTs: base, value: targets, t: T0 })

    expect(await app.sync.syncNow()).toMatchObject({ state: 'idle', pendingEdits: 0 })
    expect(pushes).toEqual([200])
    const file = server.file()
    expect(file.nutritionTargets).toEqual(targets)
    expect(file.edited.nutritionTargets).toBeGreaterThan(nourished().edited.nutritionTargets)
    expect(without(file.edited, ['nutritionTargets'])).toEqual(without(nourished().edited, ['nutritionTargets']))
    expect(file.nutritionDays).toEqual(nourished().nutritionDays)
    expect(file.supplements).toEqual(nourished().supplements)
    expect((await app.copy.get()).state).toEqual(without(file, HIDDEN))
    expect(await editRows(app)).toEqual([{ kind: 'setting', key: 'nutritionTargets', acked_at: new Date(T0).toISOString(), superseded_at: null }])
    expect(await app.edits.listNotices()).toEqual([])

    expect(await app.sync.syncNow()).toMatchObject({ state: 'idle', pendingEdits: 0 })
    expect(pushes).toEqual([200])
    expect(server.file()).toEqual(file)
  })

  test('the web edits the same day before the phone pushes: the phone\'s edit is superseded as changed and never sent', async () => {
    const server = await startServer({ state: nourished() })
    const { client, pushes } = watched()
    const app = await paired(server, undefined, { client })
    await dayEdit(app, '2026-11-07', { ...without(nourished().nutritionDays['2026-11-07'], ['_ts']), kcal: 2300 })
    await server.webWrites(state => ({ ...state, nutritionDays: { ...state.nutritionDays, '2026-11-07': { ...state.nutritionDays['2026-11-07'], kcal: 1900, _ts: T0 + 500 } } }))
    const before = server.file()
    expect(before.nutritionDays['2026-11-07']).toMatchObject({ kcal: 1900, _ts: T0 + 500 })

    expect(await app.sync.syncNow()).toMatchObject({ state: 'idle', pendingEdits: 0 })
    expect(pushes).toEqual([])
    expect(server.file()).toEqual(before)
    expect((await app.copy.get()).state.nutritionDays['2026-11-07']).toEqual(before.nutritionDays['2026-11-07'])
    expect(await app.edits.listPending()).toEqual([])
    expect(await app.edits.listNotices()).toEqual([{ kind: 'nutritionDay', key: '2026-11-07', name: '2026-11-07', reason: 'changed', at: new Date(T0).toISOString() }])

    expect(await app.sync.syncNow()).toMatchObject({ state: 'idle', pendingEdits: 0 })
    expect(pushes).toEqual([])
  })

  test('the phone edits one day while the web edits another: a real 409, one retry, and both days survive', async () => {
    const server = await startServer({ state: nourished() })
    const { client, pushes } = watched()
    const app = await paired(server, undefined, { client })
    await dayEdit(app, '2026-11-08', DAY)
    const web = { ...nourished().nutritionDays['2026-11-07'], note: 'from the web', _ts: T0 + 500 }
    client.before = () => server.webWrites(state => ({ ...state, nutritionDays: { ...state.nutritionDays, '2026-11-07': web } }))

    expect(await app.sync.syncNow()).toMatchObject({ state: 'idle', pendingEdits: 0 })
    expect(pushes).toEqual(['conflict', 200])
    const file = server.file()
    expect(file.nutritionDays['2026-11-07']).toEqual(web)
    expect(without(file.nutritionDays['2026-11-08'], ['_ts'])).toEqual(DAY)
    expect(file.nutritionDays['2026-11-08']._ts).toBeGreaterThan(T0 + 500)
    expect((await app.copy.get()).state).toEqual(without(file, HIDDEN))
    expect(await app.edits.listPending()).toEqual([])
    expect(await app.edits.listNotices()).toEqual([])
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

  // WHOOP, read-only: the phone's three calls against the real routes, with the paired bearer and
  // no body. Nothing here reaches WHOOP: no profile is connected, and the base is a dead loopback.
  const WHOOP_OFF = { WHOOP_CLIENT_ID: '', WHOOP_CLIENT_SECRET: '' }
  const WHOOP_ON = { WHOOP_CLIENT_ID: 'contract-client', WHOOP_CLIENT_SECRET: 'contract-secret', WHOOP_BASE_URL: 'http://127.0.0.1:9' }

  test('WHOOP not set up on the server: the read says so, Connect is refused as not set up, Disconnect is a no-op', async () => {
    const server = await startServer({ env: WHOOP_OFF })
    const app = await paired(server)
    const token = (await createCredentials(app.keychain).get()).token
    expect(await app.client.getWhoop(server.api, token)).toEqual({ ok: true, whoop: { configured: false, connected: false, fetchedAt: null, stale: false, days: [], workouts: [] } })
    expect(await app.client.whoopConnectLink(server.api, token)).toEqual({ ok: false, kind: 'unconfigured' })
    expect(await app.client.whoopDisconnect(server.api, token)).toEqual({ ok: true, revoked: false, wasConnected: false })
    expect(await app.client.getWhoop(server.api, 'not-a-token')).toEqual({ ok: false, kind: 'unauthorized' })
  })

  test('WHOOP set up, not connected: the read, a one-use link on ORIGIN, and the source refusing it on another origin', async () => {
    const server = await startServer({ env: WHOOP_ON })
    const app = await paired(server)
    // Pairing keeps the profile's id from the redeem, which keys the WHOOP card's reads.
    expect(await app.meta.get('profileId')).toBe(UID)
    const token = (await createCredentials(app.keychain).get()).token
    expect(await app.client.getWhoop(server.api, token)).toEqual({ ok: true, whoop: { configured: true, connected: false, fetchedAt: null, stale: false, days: [], workouts: [] } })
    const link = await app.client.whoopConnectLink(server.api, token)
    expect(link.ok).toBe(true)
    expect(link.url).toMatch(/^http:\/\/localhost:8080\/api\/whoop\/connect\?c=[A-Za-z0-9_-]{43}$/)
    expect(link.url).not.toContain(token)
    expect(isServerLink(link.url, 'http://localhost:8080')).toBe(true)
    // Paired at another address than the server's ORIGIN: the source will not open it.
    const source = createWhoopSource({
      client: app.client,
      cache: app.whoopCache,
      pairing: async () => ({ base: await app.meta.get('server'), token, profileId: await app.meta.get('profileId') }),
      now: () => T0,
    })
    expect(await source.connectLink()).toEqual({ ok: false, elsewhere: 'localhost:8080' })
    expect(await source.read()).toEqual({ paired: true, payload: { configured: true, connected: false, fetchedAt: null, stale: false, days: [], workouts: [] }, cached: false })
    expect(await app.client.whoopDisconnect(server.api, token)).toEqual({ ok: true, revoked: false, wasConnected: false })
  })
})
