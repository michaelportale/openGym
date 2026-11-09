import { describe, expect, test } from 'vitest'
import { createNodeSqliteDb, createNodeSqliteFileDb } from '../../scripts/node-sqlite.mjs'
import { createMemoryRoutineEdits, createSqliteRoutineEdits } from './routine-edits.js'

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
    expect(await s.list()).toEqual([edit])
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
    await s.markSent([{ rid: 'r1', t: 5, routine: r1 }])
    const edited = { ...r1, name: 'Pull' }
    await s.put({ rid: 'r1', baseTs: 200, routine: edited, t: 6 })
    expect(await s.get('r1')).toEqual({ rid: 'r1', baseTs: 100, routine: edited, sent: r1, t: 6 })
  })

  test('a put on an acked row is pending again on the caller\'s base, with sent = the acked routine, known to be on the server', async () => {
    const s = make()
    await s.put({ rid: 'r1', baseTs: 100, routine: r1, t: 5 })
    await s.markSent([{ rid: 'r1', t: 5, routine: { ...r1, name: 'as sent' } }])
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
    await s.markSent([{ rid: 'r1', t: 4, routine: { name: 'in flight' } }])
    expect(await s.get('r1')).toEqual({ rid: 'r1', baseTs: 1, routine: r1, sent: { name: 'in flight' }, t: 5 })
    await s.markSent([{ rid: 'r1', t: 5, routine: r1 }])
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
    await s.markSent([{ rid: 'a', t: 1, routine: { name: 'A' } }, { rid: 'b', t: 2, routine: { name: 'B' } }, { rid: 'zzz', t: 1, routine: {} }])
    expect((await s.get('a')).sent).toBeNull()
    expect((await s.get('b')).sent).toBeNull()
    expect((await s.list()).map(e => e.rid)).toEqual(['a', 'b'])
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

  test('a put after superseded starts a fresh pending row', async () => {
    const s = make()
    await s.put({ rid: 'r1', baseTs: 1, routine: r1, t: 5 })
    await s.markSent([{ rid: 'r1', t: 5, routine: r1 }])
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
    expect(await s.list()).toEqual([])
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

test('two stores on one db migrate once', async () => {
  const db = createNodeSqliteDb()
  const stores = [createSqliteRoutineEdits(db), createSqliteRoutineEdits(db)]
  await Promise.all(stores.map(s => s.list()))
  expect(db.executed.filter(sql => /CREATE TABLE IF NOT EXISTS routine_edits/.test(sql))).toHaveLength(1)
})

test('sqlite store needs a db handle', () => {
  expect(() => createSqliteRoutineEdits({})).toThrow()
})
