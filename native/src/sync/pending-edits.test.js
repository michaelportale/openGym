import { describe, expect, test } from 'vitest'
import { createNodeSqliteDb, createNodeSqliteFileDb } from '../../scripts/node-sqlite.mjs'
import { createMemoryRoutineEdits, createSqliteRoutineEdits } from './pending-edits.js'

const makers = {
  memory: () => createMemoryRoutineEdits(),
  sqlite: () => createSqliteRoutineEdits(createNodeSqliteDb()),
}

const r1 = { id: 'r1', name: 'Push', days: [] }

describe.each(Object.entries(makers))('%s routine edits', (_, make) => {
  test('put then listPending returns the edit with baseTs', async () => {
    const s = make()
    expect(await s.put({ rid: 'r1', baseTs: 100, routine: r1, t: 5 })).toMatchObject({ ok: true, rid: 'r1', t: 5 })
    const edit = { rid: 'r1', baseTs: 100, routine: r1, sent: null, t: 5 }
    expect(await s.listPending()).toEqual([edit])
    expect(await s.get('r1')).toEqual(edit)
    expect(await s.get('nope')).toBeNull()
  })

  test('listPending is ordered by t and hands out copies', async () => {
    const s = make()
    await s.put({ rid: 'b', baseTs: null, routine: { name: 'B' }, t: 9 })
    await s.put({ rid: 'a', baseTs: null, routine: { name: 'A' }, t: 3 })
    expect((await s.listPending()).map(e => e.rid)).toEqual(['a', 'b'])
    ;(await s.get('a')).routine.name = 'changed'
    expect((await s.get('a')).routine.name).toBe('A')
  })

  test('a second put on a pending row keeps baseTs and sent', async () => {
    const s = make()
    await s.put({ rid: 'r1', baseTs: 100, routine: r1, t: 5 })
    await s.markSent([{ rid: 'r1', t: 5, baseTs: 100, routine: r1 }])
    const edited = { ...r1, name: 'Pull' }
    await s.put({ rid: 'r1', baseTs: 200, routine: edited, t: 6 })
    expect(await s.get('r1')).toEqual({ rid: 'r1', baseTs: 100, routine: edited, sent: r1, t: 6 })
  })

  test('a put on an acked row is pending again on the caller\'s base, with sent = the acked routine, known to be on the server', async () => {
    const s = make()
    await s.put({ rid: 'r1', baseTs: 100, routine: r1, t: 5 })
    await s.markSent([{ rid: 'r1', t: 5, baseTs: 100, routine: { ...r1, name: 'as sent' } }])
    await s.markAcked([{ rid: 'r1', t: 5 }], 'a')
    expect(await s.listPending()).toEqual([])
    await s.put({ rid: 'r1', baseTs: 300, routine: { ...r1, name: 'X' }, t: 7 })
    expect(await s.listPending()).toEqual([{ rid: 'r1', baseTs: 300, routine: { ...r1, name: 'X' }, sent: r1, t: 7 }])
    // acked without ever being sent from here (the server already had it): the same
    await s.put({ rid: 'r2', baseTs: 1, routine: { id: 'r2' }, t: 1 })
    await s.markAcked([{ rid: 'r2', t: 1 }], 'a')
    await s.put({ rid: 'r2', baseTs: 2, routine: { id: 'r2', name: 'Y' }, t: 2 })
    expect(await s.get('r2')).toEqual({ rid: 'r2', baseTs: 2, routine: { id: 'r2', name: 'Y' }, sent: { id: 'r2' }, t: 2 })
  })

  test('a fresh put (made with no server copy held, on the snapshot) starts the row over whatever it holds: the caller\'s baseTs, sent null, not acked or superseded', async () => {
    const s = make()
    // pending, with what a push sent
    await s.put({ rid: 'p', baseTs: 100, routine: { name: 'P' }, t: 1 })
    await s.markSent([{ rid: 'p', baseTs: 100, routine: { name: 'P' } }])
    await s.put({ rid: 'p', baseTs: 7, routine: { name: 'P2' }, t: 2, fresh: true })
    expect(await s.get('p')).toEqual({ rid: 'p', baseTs: 7, routine: { name: 'P2' }, sent: null, t: 2 })
    // acked: no sent from the ack either
    await s.put({ rid: 'a', baseTs: 100, routine: { name: 'A' }, t: 1 })
    await s.markAcked([{ rid: 'a', t: 1 }], 'x')
    await s.put({ rid: 'a', baseTs: 7, routine: { name: 'A2' }, t: 2, fresh: true })
    expect(await s.get('a')).toEqual({ rid: 'a', baseTs: 7, routine: { name: 'A2' }, sent: null, t: 2 })
    // superseded and dismissed
    await s.put({ rid: 'x', baseTs: 100, routine: { name: 'X' }, t: 1 })
    await s.markSuperseded([{ rid: 'x', t: 1, kind: 'changed' }], 'y')
    await s.dismiss('x')
    await s.put({ rid: 'x', baseTs: null, routine: { name: 'X2' }, t: 2, fresh: true })
    expect(await s.get('x')).toEqual({ rid: 'x', baseTs: null, routine: { name: 'X2' }, sent: null, t: 2 })
    expect((await s.listPending()).map(e => e.rid).sort()).toEqual(['a', 'p', 'x'])
    expect(await s.listNotices()).toEqual([])
    // the same t with other content still moves up one
    expect(await s.put({ rid: 'p', baseTs: 7, routine: { name: 'P3' }, t: 2, fresh: true })).toMatchObject({ t: 3 })
    // only `true` is fresh
    await s.put({ rid: 'p', baseTs: 9, routine: { name: 'P4' }, t: 4, fresh: 'yes' })
    expect(await s.get('p')).toMatchObject({ baseTs: 7 })
  })

  test('markAcked with an old t does nothing', async () => {
    const s = make()
    await s.put({ rid: 'r1', baseTs: 1, routine: r1, t: 5 })
    await s.put({ rid: 'r1', baseTs: 1, routine: { ...r1, name: 'N' }, t: 6 })
    await s.markAcked([{ rid: 'r1', t: 5 }, { rid: 'zzz', t: 1 }], 'a')
    expect((await s.listPending()).map(e => e.rid)).toEqual(['r1'])
    await s.markAcked([{ rid: 'r1', t: 6 }], 'a')
    expect(await s.listPending()).toEqual([])
  })

  test('markSent records what was sent on a pending row whatever its t; rebase only while t matches, and clears sent and sets baseTs', async () => {
    const s = make()
    await s.put({ rid: 'r1', baseTs: 1, routine: r1, t: 5 })
    // a newer edit was saved after the push read the row: what went out is still recorded
    await s.markSent([{ rid: 'r1', t: 4, baseTs: 1, routine: { name: 'in flight' } }])
    expect(await s.get('r1')).toEqual({ rid: 'r1', baseTs: 1, routine: r1, sent: { name: 'in flight' }, t: 5 })
    await s.markSent([{ rid: 'r1', t: 5, baseTs: 1, routine: r1 }])
    expect((await s.get('r1')).sent).toEqual(r1)
    await s.rebase([{ rid: 'r1', t: 4, baseTs: 9 }])
    expect(await s.get('r1')).toMatchObject({ baseTs: 1, sent: r1 })
    await s.rebase([{ rid: 'r1', t: 5, baseTs: 9 }])
    expect(await s.get('r1')).toMatchObject({ baseTs: 9, sent: null })
  })

  test('markSent leaves an acked or superseded row, and an unknown rid, alone', async () => {
    const s = make()
    await s.put({ rid: 'a', baseTs: 1, routine: { name: 'A' }, t: 1 })
    await s.put({ rid: 'b', baseTs: 1, routine: { name: 'B' }, t: 2 })
    await s.markAcked([{ rid: 'a', t: 1 }], 'x')
    await s.markSuperseded([{ rid: 'b', t: 2, kind: 'changed' }], 'y')
    await s.markSent([{ rid: 'a', t: 1, baseTs: 1, routine: { name: 'A' } }, { rid: 'b', t: 2, baseTs: 1, routine: { name: 'B' } }, { rid: 'zzz', t: 1, baseTs: 1, routine: {} }])
    expect((await s.get('a')).sent).toBeNull()
    expect((await s.get('b')).sent).toBeNull()
    expect(await s.get('zzz')).toBeNull()
  })

  test('markSent passes over a row whose baseTs is no longer the one the push listed: a fresh put started it over', async () => {
    const s = make()
    await s.put({ rid: 'r1', baseTs: 1500, routine: r1, t: 5 })
    await s.put({ rid: 'r1', baseTs: 1000, routine: { ...r1, name: 'On the snapshot' }, t: 6, fresh: true })
    await s.markSent([{ rid: 'r1', t: 5, baseTs: 1500, routine: r1 }])
    expect(await s.get('r1')).toEqual({ rid: 'r1', baseTs: 1000, routine: { ...r1, name: 'On the snapshot' }, sent: null, t: 6 })
    // a null base matches a null base only
    await s.put({ rid: 'n', baseTs: null, routine: { name: 'N' }, t: 1 })
    await s.markSent([{ rid: 'n', t: 1, baseTs: 0, routine: { name: 'N' } }])
    expect((await s.get('n')).sent).toBeNull()
    await s.markSent([{ rid: 'n', t: 1, baseTs: null, routine: { name: 'N' } }])
    expect((await s.get('n')).sent).toEqual({ name: 'N' })
  })

  test('markSuperseded leaves listPending and shows in listNotices until dismissed', async () => {
    const s = make()
    await s.put({ rid: 'r1', baseTs: 1, routine: r1, t: 5 })
    await s.put({ rid: 'r2', baseTs: 1, routine: { id: 'r2' }, t: 6 })
    await s.markSuperseded([{ rid: 'r1', t: 4, kind: 'changed' }], 'late')
    expect(await s.listNotices()).toEqual([])
    await s.markSuperseded([{ rid: 'r2', t: 6, kind: 'deleted' }], '2026-02-02')
    await s.markSuperseded([{ rid: 'r1', t: 5, kind: 'changed' }], '2026-02-01')
    expect(await s.listPending()).toEqual([])
    expect(await s.listNotices()).toEqual([
      { rid: 'r1', name: 'Push', kind: 'changed', at: '2026-02-01' },
      { rid: 'r2', name: '', kind: 'deleted', at: '2026-02-02' },
    ])
    await s.dismiss('r1')
    expect((await s.listNotices()).map(n => n.rid)).toEqual(['r2'])
  })

  test('dismiss acts on a superseded row only: a stale Dismiss on a row edited again never hides its next notice', async () => {
    const s = make()
    await s.put({ rid: 'r1', baseTs: 1, routine: r1, t: 5 })
    await s.dismiss('r1')
    await s.markSuperseded([{ rid: 'r1', t: 5, kind: 'changed' }], 'x')
    expect((await s.listNotices()).map(n => n.rid)).toEqual(['r1'])
    await s.dismiss('r1')
    expect(await s.listNotices()).toEqual([])
  })

  test('a put after superseded starts a fresh pending row', async () => {
    const s = make()
    await s.put({ rid: 'r1', baseTs: 1, routine: r1, t: 5 })
    await s.markSent([{ rid: 'r1', t: 5, baseTs: 1, routine: r1 }])
    await s.markSuperseded([{ rid: 'r1', t: 5, kind: 'changed' }], 'x')
    await s.dismiss('r1')
    await s.put({ rid: 'r1', baseTs: 77, routine: { ...r1, name: 'New' }, t: 8 })
    expect(await s.listPending()).toEqual([{ rid: 'r1', baseTs: 77, routine: { ...r1, name: 'New' }, sent: null, t: 8 }])
    expect(await s.listNotices()).toEqual([])
    // not dismissed any more: superseding again shows the notice again
    await s.markSuperseded([{ rid: 'r1', t: 8, kind: 'deleted' }], 'y')
    expect(await s.listNotices()).toEqual([{ rid: 'r1', name: 'New', kind: 'deleted', at: 'y' }])
  })

  test('same t with different content bumps t', async () => {
    const s = make()
    await s.put({ rid: 'r1', baseTs: 1, routine: r1, t: 5 })
    await s.put({ rid: 'r1', baseTs: 1, routine: { ...r1 }, t: 5 })
    expect((await s.get('r1')).t).toBe(5)
    expect(await s.put({ rid: 'r1', baseTs: 1, routine: { ...r1, name: 'Z' }, t: 5 })).toMatchObject({ t: 6 })
    await s.markAcked([{ rid: 'r1', t: 5 }], 'a')
    expect((await s.listPending()).map(e => e.rid)).toEqual(['r1'])
  })

  test('resetAcked re-pends acked rows only', async () => {
    const s = make()
    await s.put({ rid: 'a', baseTs: 1, routine: { name: 'A' }, t: 1 })
    await s.put({ rid: 'b', baseTs: 1, routine: { name: 'B' }, t: 2 })
    await s.markAcked([{ rid: 'a', t: 1 }], 'x')
    await s.markSuperseded([{ rid: 'b', t: 2, kind: 'changed' }], 'y')
    await s.resetAcked()
    expect((await s.listPending()).map(e => e.rid)).toEqual(['a'])
    expect((await s.listNotices()).map(n => n.rid)).toEqual(['b'])
  })

  test('a row resetAcked re-pends (a resend to a restored server) that then supersedes is settled silently: acked, no notice', async () => {
    const s = make()
    await s.put({ rid: 'a', baseTs: 1, routine: { name: 'A' }, t: 1 })
    await s.markAcked([{ rid: 'a', t: 1 }], 'x')
    await s.resetAcked()
    expect((await s.listPending()).map(e => e.rid)).toEqual(['a'])
    await s.markSuperseded([{ rid: 'a', t: 1, kind: 'changed' }], 'y')
    expect(await s.listPending()).toEqual([])
    expect(await s.listNotices()).toEqual([])
    // re-pended again by a later resend, it is still the old edit
    await s.resetAcked()
    await s.markSuperseded([{ rid: 'a', t: 1, kind: 'deleted' }], 'z')
    expect(await s.listNotices()).toEqual([])
    // a put after the re-pend is a new edit: superseding that one says so
    await s.put({ rid: 'b', baseTs: 1, routine: { name: 'B' }, t: 2 })
    await s.markAcked([{ rid: 'b', t: 2 }], 'x')
    await s.resetAcked()
    await s.put({ rid: 'b', baseTs: 1, routine: { name: 'B2' }, t: 3 })
    await s.markSuperseded([{ rid: 'b', t: 3, kind: 'changed' }], 'z')
    expect(await s.listNotices()).toEqual([{ rid: 'b', name: 'B2', kind: 'changed', at: 'z' }])
  })

  test('invalid input throws', async () => {
    const s = make()
    await expect(s.put({ baseTs: 1, routine: r1, t: 1 })).rejects.toThrow()
    await expect(s.put({ rid: '', baseTs: 1, routine: r1, t: 1 })).rejects.toThrow()
    await expect(s.put({ rid: 'a', baseTs: 1, routine: 'x', t: 1 })).rejects.toThrow()
    await expect(s.put({ rid: 'a', baseTs: 1, routine: [], t: 1 })).rejects.toThrow()
    await expect(s.put({ rid: 'a', baseTs: 1, routine: null, t: 1 })).rejects.toThrow()
    await expect(s.put({ rid: 'a', baseTs: 1, routine: r1, t: NaN })).rejects.toThrow()
    await expect(s.put({ rid: 'a', baseTs: 1, routine: r1, t: Infinity })).rejects.toThrow()
    await expect(s.put({ rid: 'a', baseTs: 'x', routine: r1, t: 1 })).rejects.toThrow()
    await expect(s.put(undefined)).rejects.toThrow()
    expect(await s.listPending()).toEqual([])
  })
})

test('real sqlite: survives a reopen with routine and sent as objects', async () => {
  let db = createNodeSqliteFileDb()
  const s = createSqliteRoutineEdits(db)
  await s.put({ rid: 'r1', baseTs: null, routine: r1, t: 5 })
  await s.markSent([{ rid: 'r1', t: 5, routine: r1 }])
  db = db.reopen()
  expect(await createSqliteRoutineEdits(db).get('r1')).toEqual({ rid: 'r1', baseTs: null, routine: r1, sent: r1, t: 5 })
})

test('real sqlite: a markSent landing while a put is on its way in is kept, since one statement reads and writes the row', async () => {
  const db = createNodeSqliteDb()
  const s = createSqliteRoutineEdits(db)
  await s.put({ rid: 'r1', baseTs: 1, routine: r1, t: 5 })
  db.holdNext(/^INSERT INTO routine_edits/)
  const put = s.put({ rid: 'r1', baseTs: 1, routine: { ...r1, name: 'Pull' }, t: 6 })
  await db.held()
  await s.markSent([{ rid: 'r1', baseTs: 1, routine: r1 }])
  db.release()
  expect(await put).toEqual({ ok: true, rid: 'r1', t: 6 })
  expect(await s.get('r1')).toEqual({ rid: 'r1', baseTs: 1, routine: { ...r1, name: 'Pull' }, sent: r1, t: 6 })
})

test('two stores on one db migrate once', async () => {
  const db = createNodeSqliteDb()
  const stores = [createSqliteRoutineEdits(db), createSqliteRoutineEdits(db)]
  await Promise.all(stores.map(s => s.listPending()))
  expect(db.executed.filter(sql => /CREATE TABLE IF NOT EXISTS routine_edits/.test(sql))).toHaveLength(1)
})

test('sqlite store needs a db handle', () => {
  expect(() => createSqliteRoutineEdits({})).toThrow()
})
