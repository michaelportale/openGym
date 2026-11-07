import { expect, test } from 'vitest'
import { createFakeSqliteDb } from './fake-sqlite.js'
import { createSessionController } from './session-controller.js'
import { openSession } from './session.js'
import { createSqliteSessionStorage } from './sqlite-storage.js'
import { createMemoryStorage } from './storage.js'

const START = Date.parse('2026-11-07T23:50:00.000Z')
const SEEN = Date.parse('2026-11-08T00:05:00.000Z')
const ERROR = { code: 'storage', message: 'checkpoint unavailable' }

function baseWorkout() {
  return {
    id: 'checkpoint-fixture', start: START,
    entries: [{ id: 'row', sets: [{ id: 'row-0', w: 20, r: 5, done: false }] }],
  }
}

function store(kind) {
  const db = kind === 'sqlite' ? createFakeSqliteDb() : null
  const storage = db ? createSqliteSessionStorage(db) : createMemoryStorage()
  const putLastSeen = storage.putLastSeen.bind(storage)
  let fail = false
  storage.putLastSeen = async (...args) => {
    if (fail) throw new Error(ERROR.message)
    return putLastSeen(...args)
  }
  return { storage, fail(value) { fail = value } }
}

for (const kind of ['memory', 'sqlite']) {
  for (const method of ['noteSeen', 'flushSeen']) {
    test(`${kind}: ${method} reports a failed checkpoint and retries the same instant without rewinding`, async () => {
      const { storage, fail } = store(kind)
      let now = START
      const session = await openSession({ base: baseWorkout(), storage, now: () => now })
      await session.flushSeen()
      now = SEEN
      expect(session.view().elapsedMs).toBe(15 * 60_000)
      fail(true)
      expect(await session[method]()).toEqual({ ok: false, saved: false, error: ERROR })
      expect(await storage.readLastSeen()).toBe(START)
      expect(session.view().elapsedMs).toBe(15 * 60_000)

      fail(false)
      expect(await session[method]()).toEqual({ ok: true, saved: true })
      expect(await storage.readLastSeen()).toBe(SEEN)
      now = Date.parse('2026-11-09T08:00:00.000Z')
      const restored = await openSession({ storage, now: () => now })
      expect(restored.view().elapsedMs).toBe(15 * 60_000)
    })
  }

  test(`${kind}: a failed checkpoint on open keeps a usable session and a visible error`, async () => {
    const { storage, fail } = store(kind)
    fail(true)
    const controller = createSessionController({ base: baseWorkout(), storage, now: () => START })
    expect(await controller.open()).toMatchObject({ status: 'ready', error: ERROR, view: { status: 'active' } })
    fail(false)
    expect(await controller.call('flushSeen')).toEqual({ ok: true, saved: true })
    expect(controller.getState().error).toBeNull()
    expect(await storage.readLastSeen()).toBe(START)
  })

  test(`${kind}: a saved command keeps its save result when the following checkpoint fails`, async () => {
    const { storage, fail } = store(kind)
    let now = START
    const controller = createSessionController({ base: baseWorkout(), storage, now: () => now })
    await controller.open()
    now = SEEN
    fail(true)
    const result = await controller.call('commitSet', {
      eventId: 'set-1', exerciseId: 'row', setId: 'row-0', fields: { w: 20, r: 5 },
    })
    expect(result).toEqual({ ok: true, saved: true, checkpointError: ERROR })
    expect(controller.getState()).toMatchObject({ status: 'ready', error: ERROR, view: { totals: { completedSets: 1 } } })
    expect((await storage.readAll()).map(event => event.id)).toEqual(['set-1'])
    fail(false)
    await controller.call('flushSeen')
    expect(controller.getState().error).toBeNull()
    expect((await storage.readAll()).map(event => event.id)).toEqual(['set-1'])
  })

  test(`${kind}: finish waits for a successful checkpoint before sending or clearing`, async () => {
    const { storage, fail } = store(kind)
    let now = START
    const controller = createSessionController({ base: baseWorkout(), storage, now: () => now })
    await controller.open()
    now = SEEN
    fail(true)
    const sent = []
    const options = { eventId: 'finish-1', end: SEEN, sender: async payload => { sent.push(payload); return { saved: true } } }
    expect(await controller.finishSession(options)).toEqual({ ok: false, saved: false, error: ERROR })
    expect(sent).toEqual([])
    expect(await storage.readAll()).toEqual([])
    expect(await storage.readBase()).toEqual(baseWorkout())
    expect(controller.getState()).toMatchObject({ status: 'ready', error: ERROR })
    fail(false)
    expect(await controller.finishSession(options)).toMatchObject({ ok: true, saved: true })
    expect(sent).toHaveLength(1)
    expect(await storage.readBase()).toBeNull()
  })

  test(`${kind}: discard leaves the journal and drafts recoverable when its checkpoint fails`, async () => {
    const { storage, fail } = store(kind)
    let now = START
    const session = await openSession({ base: baseWorkout(), storage, now: () => now })
    await session.setNote({ eventId: 'note-1', note: 'fixture' })
    await session.putDraft('row-0', { r: 6 })
    await session.flushSeen()
    now = SEEN
    fail(true)
    expect(await session.discard()).toEqual({ ok: false, saved: false, error: ERROR })
    expect(session.view().status).toBe('active')
    expect((await storage.readAll()).map(event => event.id)).toEqual(['note-1'])
    expect(await storage.readDrafts()).toEqual({ 'row-0': { r: 6 } })
    expect(await storage.readBase()).toEqual(baseWorkout())
    fail(false)
    expect(await session.discard()).toEqual({ ok: true, saved: true })
    expect(await storage.readAll()).toEqual([])
    expect(await storage.readDrafts()).toEqual({})
    expect(await storage.readBase()).toBeNull()
  })

  test(`${kind}: a checkpoint failure after sender confirmation preserves the sealed journal`, async () => {
    const { storage, fail } = store(kind)
    let now = START
    const controller = createSessionController({ base: baseWorkout(), storage, now: () => now })
    await controller.open()
    const result = await controller.finishSession({
      eventId: 'finish-1', end: START + 60_000,
      sender: async () => { now += 60_000; fail(true); return { saved: true } },
    })
    expect(result).toMatchObject({ ok: false, saved: true, error: ERROR })
    expect(controller.getState()).toMatchObject({ status: 'ready', error: ERROR, view: { status: 'finished' } })
    expect((await storage.readAll()).map(event => event.id)).toEqual(['finish-1'])
    expect(await storage.readBase()).toEqual(baseWorkout())
    fail(false)
    expect(await controller.finishSession({ sender: async () => ({ saved: true }) })).toMatchObject({ ok: true, saved: true })
    expect(await storage.readBase()).toBeNull()
  })
}
