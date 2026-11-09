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
  const sync = createSync({ client, credentials: createCredentials(keychain), copy, workouts, meta, now: () => T0 })
  return { sync, workouts, copy, meta, keychain, client }
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
      paired: true, state: 'idle', lastSyncedAt: new Date(T0).toISOString(), pending: 0, copyKey: `${stored.rev}|${stored.wid}`, server: server.api, profile: 'Owner',
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
