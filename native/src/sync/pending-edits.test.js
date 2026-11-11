import { describe, expect, test } from 'vitest'
import { createNodeSqliteDb, createNodeSqliteFileDb } from '../../scripts/node-sqlite.mjs'
import { ROUTINE_DELETED } from './edit-guard.js'
import { createMemoryPendingEdits, createSqlitePendingEdits } from './pending-edits.js'

const makers = {
  memory: () => createMemoryPendingEdits(),
  sqlite: () => createSqlitePendingEdits(createNodeSqliteDb()),
}

const r1 = { id: 'r1', name: 'Push', days: [] }

describe.each(Object.entries(makers))('%s pending edits', (_, make) => {
  test('put then listPending returns the edit with baseTs', async () => {
    const s = make()
    expect(await s.put({ kind: 'routine', key: 'r1', baseTs: 100, value: r1, t: 5 })).toMatchObject({ ok: true, kind: 'routine', key: 'r1', t: 5 })
    const edit = { kind: 'routine', key: 'r1', baseTs: 100, value: r1, sent: null, t: 5 }
    expect(await s.listPending()).toEqual([edit])
    expect(await s.get('routine', 'r1')).toEqual(edit)
    expect(await s.get('routine', 'nope')).toBeNull()
  })

  test('listPending is ordered by t and hands out copies', async () => {
    const s = make()
    await s.put({ kind: 'routine', key: 'b', baseTs: null, value: { name: 'B' }, t: 9 })
    await s.put({ kind: 'routine', key: 'a', baseTs: null, value: { name: 'A' }, t: 3 })
    expect((await s.listPending()).map(e => e.key)).toEqual(['a', 'b'])
    ;(await s.get('routine', 'a')).value.name = 'changed'
    expect((await s.get('routine', 'a')).value.name).toBe('A')
  })

  // A routine create (base 0) and delete (edit-guard.js ROUTINE_DELETED): the marker is stored and
  // sent like any routine value, and base 0 stays 0, never null (a null base is a seed routine's).
  test('a delete row holds the marker and markSent records it without throwing; a create keeps base 0, and a delete put over it keeps base 0', async () => {
    const s = make()
    await s.put({ kind: 'routine', key: 'r1', baseTs: 100, value: ROUTINE_DELETED, t: 5 })
    await expect(s.markSent([{ kind: 'routine', key: 'r1', t: 5, baseTs: 100, value: ROUTINE_DELETED }])).resolves.toEqual({ ok: true })
    expect(await s.get('routine', 'r1')).toEqual({ kind: 'routine', key: 'r1', baseTs: 100, value: ROUTINE_DELETED, sent: ROUTINE_DELETED, t: 5 })
    await s.put({ kind: 'routine', key: 'n', baseTs: 0, value: { id: 'n', name: 'New' }, t: 6 })
    expect((await s.get('routine', 'n')).baseTs).toBe(0)
    await s.markSent([{ kind: 'routine', key: 'n', t: 6, baseTs: 0, value: { id: 'n', name: 'New' } }])
    expect((await s.get('routine', 'n')).sent).toEqual({ id: 'n', name: 'New' })
    await s.put({ kind: 'routine', key: 'n', baseTs: null, value: ROUTINE_DELETED, t: 7 })
    expect(await s.get('routine', 'n')).toEqual({ kind: 'routine', key: 'n', baseTs: 0, value: ROUTINE_DELETED, sent: { id: 'n', name: 'New' }, t: 7 })
  })

  test('a second put on a pending row keeps baseTs and sent', async () => {
    const s = make()
    await s.put({ kind: 'routine', key: 'r1', baseTs: 100, value: r1, t: 5 })
    await s.markSent([{ kind: 'routine', key: 'r1', t: 5, baseTs: 100, value: r1 }])
    const edited = { ...r1, name: 'Pull' }
    await s.put({ kind: 'routine', key: 'r1', baseTs: 200, value: edited, t: 6 })
    expect(await s.get('routine', 'r1')).toEqual({ kind: 'routine', key: 'r1', baseTs: 100, value: edited, sent: r1, t: 6 })
  })

  test('a put on an acked row is pending again on the caller\'s base, with sent = the acked routine, known to be on the server', async () => {
    const s = make()
    await s.put({ kind: 'routine', key: 'r1', baseTs: 100, value: r1, t: 5 })
    await s.markSent([{ kind: 'routine', key: 'r1', t: 5, baseTs: 100, value: { ...r1, name: 'as sent' } }])
    await s.markAcked([{ kind: 'routine', key: 'r1', t: 5 }], 'a')
    expect(await s.listPending()).toEqual([])
    await s.put({ kind: 'routine', key: 'r1', baseTs: 300, value: { ...r1, name: 'X' }, t: 7 })
    expect(await s.listPending()).toEqual([{ kind: 'routine', key: 'r1', baseTs: 300, value: { ...r1, name: 'X' }, sent: r1, t: 7 }])
    // acked without ever being sent from here (the server already had it): the same
    await s.put({ kind: 'routine', key: 'r2', baseTs: 1, value: { id: 'r2' }, t: 1 })
    await s.markAcked([{ kind: 'routine', key: 'r2', t: 1 }], 'a')
    await s.put({ kind: 'routine', key: 'r2', baseTs: 2, value: { id: 'r2', name: 'Y' }, t: 2 })
    expect(await s.get('routine', 'r2')).toEqual({ kind: 'routine', key: 'r2', baseTs: 2, value: { id: 'r2', name: 'Y' }, sent: { id: 'r2' }, t: 2 })
  })

  test('a fresh put (made with no server copy held, on the snapshot) starts the row over whatever it holds: the caller\'s baseTs, sent null, not acked or superseded', async () => {
    const s = make()
    // pending, with what a push sent
    await s.put({ kind: 'routine', key: 'p', baseTs: 100, value: { name: 'P' }, t: 1 })
    await s.markSent([{ kind: 'routine', key: 'p', baseTs: 100, value: { name: 'P' } }])
    await s.put({ kind: 'routine', key: 'p', baseTs: 7, value: { name: 'P2' }, t: 2, fresh: true })
    expect(await s.get('routine', 'p')).toEqual({ kind: 'routine', key: 'p', baseTs: 7, value: { name: 'P2' }, sent: null, t: 2 })
    // acked: no sent from the ack either
    await s.put({ kind: 'routine', key: 'a', baseTs: 100, value: { name: 'A' }, t: 1 })
    await s.markAcked([{ kind: 'routine', key: 'a', t: 1 }], 'x')
    await s.put({ kind: 'routine', key: 'a', baseTs: 7, value: { name: 'A2' }, t: 2, fresh: true })
    expect(await s.get('routine', 'a')).toEqual({ kind: 'routine', key: 'a', baseTs: 7, value: { name: 'A2' }, sent: null, t: 2 })
    // superseded and dismissed
    await s.put({ kind: 'routine', key: 'x', baseTs: 100, value: { name: 'X' }, t: 1 })
    await s.markSuperseded([{ kind: 'routine', key: 'x', t: 1, reason: 'changed' }], 'y')
    await s.dismiss('routine', 'x')
    await s.put({ kind: 'routine', key: 'x', baseTs: null, value: { name: 'X2' }, t: 2, fresh: true })
    expect(await s.get('routine', 'x')).toEqual({ kind: 'routine', key: 'x', baseTs: null, value: { name: 'X2' }, sent: null, t: 2 })
    expect((await s.listPending()).map(e => e.key).sort()).toEqual(['a', 'p', 'x'])
    expect(await s.listNotices()).toEqual([])
    // the same t with other content still moves up one
    expect(await s.put({ kind: 'routine', key: 'p', baseTs: 7, value: { name: 'P3' }, t: 2, fresh: true })).toMatchObject({ t: 3 })
    // only `true` is fresh
    await s.put({ kind: 'routine', key: 'p', baseTs: 9, value: { name: 'P4' }, t: 4, fresh: 'yes' })
    expect(await s.get('routine', 'p')).toMatchObject({ baseTs: 7 })
  })

  test('markAcked with an old t does nothing', async () => {
    const s = make()
    await s.put({ kind: 'routine', key: 'r1', baseTs: 1, value: r1, t: 5 })
    await s.put({ kind: 'routine', key: 'r1', baseTs: 1, value: { ...r1, name: 'N' }, t: 6 })
    await s.markAcked([{ kind: 'routine', key: 'r1', t: 5 }, { kind: 'routine', key: 'zzz', t: 1 }], 'a')
    expect((await s.listPending()).map(e => e.key)).toEqual(['r1'])
    await s.markAcked([{ kind: 'routine', key: 'r1', t: 6 }], 'a')
    expect(await s.listPending()).toEqual([])
  })

  test('markSent records what was sent on a pending row whatever its t; rebase only while t matches, and clears sent and sets baseTs', async () => {
    const s = make()
    await s.put({ kind: 'routine', key: 'r1', baseTs: 1, value: r1, t: 5 })
    // a newer edit was saved after the push read the row: what went out is still recorded
    await s.markSent([{ kind: 'routine', key: 'r1', t: 4, baseTs: 1, value: { name: 'in flight' } }])
    expect(await s.get('routine', 'r1')).toEqual({ kind: 'routine', key: 'r1', baseTs: 1, value: r1, sent: { name: 'in flight' }, t: 5 })
    await s.markSent([{ kind: 'routine', key: 'r1', t: 5, baseTs: 1, value: r1 }])
    expect((await s.get('routine', 'r1')).sent).toEqual(r1)
    await s.rebase([{ kind: 'routine', key: 'r1', t: 4, baseTs: 9 }])
    expect(await s.get('routine', 'r1')).toMatchObject({ baseTs: 1, sent: r1 })
    await s.rebase([{ kind: 'routine', key: 'r1', t: 5, baseTs: 9 }])
    expect(await s.get('routine', 'r1')).toMatchObject({ baseTs: 9, sent: null })
  })

  test('markSent leaves an acked or superseded row, and an unknown key, alone', async () => {
    const s = make()
    await s.put({ kind: 'routine', key: 'a', baseTs: 1, value: { name: 'A' }, t: 1 })
    await s.put({ kind: 'routine', key: 'b', baseTs: 1, value: { name: 'B' }, t: 2 })
    await s.markAcked([{ kind: 'routine', key: 'a', t: 1 }], 'x')
    await s.markSuperseded([{ kind: 'routine', key: 'b', t: 2, reason: 'changed' }], 'y')
    await s.markSent([{ kind: 'routine', key: 'a', t: 1, baseTs: 1, value: { name: 'A' } }, { kind: 'routine', key: 'b', t: 2, baseTs: 1, value: { name: 'B' } }, { kind: 'routine', key: 'zzz', t: 1, baseTs: 1, value: {} }])
    expect((await s.get('routine', 'a')).sent).toBeNull()
    expect((await s.get('routine', 'b')).sent).toBeNull()
    expect(await s.get('routine', 'zzz')).toBeNull()
  })

  test('markSent passes over a row whose baseTs is no longer the one the push listed: a fresh put started it over', async () => {
    const s = make()
    await s.put({ kind: 'routine', key: 'r1', baseTs: 1500, value: r1, t: 5 })
    await s.put({ kind: 'routine', key: 'r1', baseTs: 1000, value: { ...r1, name: 'On the snapshot' }, t: 6, fresh: true })
    await s.markSent([{ kind: 'routine', key: 'r1', t: 5, baseTs: 1500, value: r1 }])
    expect(await s.get('routine', 'r1')).toEqual({ kind: 'routine', key: 'r1', baseTs: 1000, value: { ...r1, name: 'On the snapshot' }, sent: null, t: 6 })
    // a null base matches a null base only
    await s.put({ kind: 'routine', key: 'n', baseTs: null, value: { name: 'N' }, t: 1 })
    await s.markSent([{ kind: 'routine', key: 'n', t: 1, baseTs: 0, value: { name: 'N' } }])
    expect((await s.get('routine', 'n')).sent).toBeNull()
    await s.markSent([{ kind: 'routine', key: 'n', t: 1, baseTs: null, value: { name: 'N' } }])
    expect((await s.get('routine', 'n')).sent).toEqual({ name: 'N' })
  })

  test('markSuperseded leaves listPending and shows in listNotices until dismissed', async () => {
    const s = make()
    await s.put({ kind: 'routine', key: 'r1', baseTs: 1, value: r1, t: 5 })
    await s.put({ kind: 'routine', key: 'r2', baseTs: 1, value: { id: 'r2' }, t: 6 })
    await s.markSuperseded([{ kind: 'routine', key: 'r1', t: 4, reason: 'changed' }], 'late')
    expect(await s.listNotices()).toEqual([])
    await s.markSuperseded([{ kind: 'routine', key: 'r2', t: 6, reason: 'deleted' }], '2026-02-02')
    await s.markSuperseded([{ kind: 'routine', key: 'r1', t: 5, reason: 'changed' }], '2026-02-01')
    expect(await s.listPending()).toEqual([])
    expect(await s.listNotices()).toEqual([
      { kind: 'routine', key: 'r1', name: 'Push', reason: 'changed', at: '2026-02-01' },
      { kind: 'routine', key: 'r2', name: '', reason: 'deleted', at: '2026-02-02' },
    ])
    await s.dismiss('routine', 'r1')
    expect((await s.listNotices()).map(n => n.key)).toEqual(['r2'])
  })

  test('dismiss acts on a superseded row only: a stale Dismiss on a row edited again never hides its next notice', async () => {
    const s = make()
    await s.put({ kind: 'routine', key: 'r1', baseTs: 1, value: r1, t: 5 })
    await s.dismiss('routine', 'r1')
    await s.markSuperseded([{ kind: 'routine', key: 'r1', t: 5, reason: 'changed' }], 'x')
    expect((await s.listNotices()).map(n => n.key)).toEqual(['r1'])
    await s.dismiss('routine', 'r1')
    expect(await s.listNotices()).toEqual([])
  })

  test('a put after superseded starts a fresh pending row', async () => {
    const s = make()
    await s.put({ kind: 'routine', key: 'r1', baseTs: 1, value: r1, t: 5 })
    await s.markSent([{ kind: 'routine', key: 'r1', t: 5, baseTs: 1, value: r1 }])
    await s.markSuperseded([{ kind: 'routine', key: 'r1', t: 5, reason: 'changed' }], 'x')
    await s.dismiss('routine', 'r1')
    await s.put({ kind: 'routine', key: 'r1', baseTs: 77, value: { ...r1, name: 'New' }, t: 8 })
    expect(await s.listPending()).toEqual([{ kind: 'routine', key: 'r1', baseTs: 77, value: { ...r1, name: 'New' }, sent: null, t: 8 }])
    expect(await s.listNotices()).toEqual([])
    // not dismissed any more: superseding again shows the notice again
    await s.markSuperseded([{ kind: 'routine', key: 'r1', t: 8, reason: 'deleted' }], 'y')
    expect(await s.listNotices()).toEqual([{ kind: 'routine', key: 'r1', name: 'New', reason: 'deleted', at: 'y' }])
  })

  test('same t with different content bumps t', async () => {
    const s = make()
    await s.put({ kind: 'routine', key: 'r1', baseTs: 1, value: r1, t: 5 })
    await s.put({ kind: 'routine', key: 'r1', baseTs: 1, value: { ...r1 }, t: 5 })
    expect((await s.get('routine', 'r1')).t).toBe(5)
    expect(await s.put({ kind: 'routine', key: 'r1', baseTs: 1, value: { ...r1, name: 'Z' }, t: 5 })).toMatchObject({ t: 6 })
    await s.markAcked([{ kind: 'routine', key: 'r1', t: 5 }], 'a')
    expect((await s.listPending()).map(e => e.key)).toEqual(['r1'])
  })

  test('resetAcked re-pends acked rows only', async () => {
    const s = make()
    await s.put({ kind: 'routine', key: 'a', baseTs: 1, value: { name: 'A' }, t: 1 })
    await s.put({ kind: 'routine', key: 'b', baseTs: 1, value: { name: 'B' }, t: 2 })
    await s.markAcked([{ kind: 'routine', key: 'a', t: 1 }], 'x')
    await s.markSuperseded([{ kind: 'routine', key: 'b', t: 2, reason: 'changed' }], 'y')
    await s.resetAcked()
    expect((await s.listPending()).map(e => e.key)).toEqual(['a'])
    expect((await s.listNotices()).map(n => n.key)).toEqual(['b'])
  })

  test('a row resetAcked re-pends (a resend to a restored server) that then supersedes is settled silently: acked, no notice', async () => {
    const s = make()
    await s.put({ kind: 'routine', key: 'a', baseTs: 1, value: { name: 'A' }, t: 1 })
    await s.markAcked([{ kind: 'routine', key: 'a', t: 1 }], 'x')
    await s.resetAcked()
    expect((await s.listPending()).map(e => e.key)).toEqual(['a'])
    await s.markSuperseded([{ kind: 'routine', key: 'a', t: 1, reason: 'changed' }], 'y')
    expect(await s.listPending()).toEqual([])
    expect(await s.listNotices()).toEqual([])
    // re-pended again by a later resend, it is still the old edit
    await s.resetAcked()
    await s.markSuperseded([{ kind: 'routine', key: 'a', t: 1, reason: 'deleted' }], 'z')
    expect(await s.listNotices()).toEqual([])
    // a put after the re-pend is a new edit: superseding that one says so
    await s.put({ kind: 'routine', key: 'b', baseTs: 1, value: { name: 'B' }, t: 2 })
    await s.markAcked([{ kind: 'routine', key: 'b', t: 2 }], 'x')
    await s.resetAcked()
    await s.put({ kind: 'routine', key: 'b', baseTs: 1, value: { name: 'B2' }, t: 3 })
    await s.markSuperseded([{ kind: 'routine', key: 'b', t: 3, reason: 'changed' }], 'z')
    expect(await s.listNotices()).toEqual([{ kind: 'routine', key: 'b', name: 'B2', reason: 'changed', at: 'z' }])
  })

  test('invalid input throws', async () => {
    const s = make()
    await expect(s.put({ kind: 'routine', baseTs: 1, value: r1, t: 1 })).rejects.toThrow()
    await expect(s.put({ kind: 'routine', key: '', baseTs: 1, value: r1, t: 1 })).rejects.toThrow()
    await expect(s.put({ kind: 'routine', key: 'a', baseTs: 1, value: 'x', t: 1 })).rejects.toThrow()
    await expect(s.put({ kind: 'routine', key: 'a', baseTs: 1, value: [], t: 1 })).rejects.toThrow()
    await expect(s.put({ kind: 'routine', key: 'a', baseTs: 1, value: null, t: 1 })).rejects.toThrow()
    await expect(s.put({ kind: 'routine', key: 'a', baseTs: 1, value: r1, t: NaN })).rejects.toThrow()
    await expect(s.put({ kind: 'routine', key: 'a', baseTs: 1, value: r1, t: Infinity })).rejects.toThrow()
    await expect(s.put({ kind: 'routine', key: 'a', baseTs: 'x', value: r1, t: 1 })).rejects.toThrow()
    await expect(s.put(undefined)).rejects.toThrow()
    expect(await s.listPending()).toEqual([])
  })

  // Nutrition days and settings share the store: a row is a kind and a key.
  const day = { kcal: 2100, protein: 160, carbs: 220, fat: 70, fiber: 30, dayType: 'training' }
  const targets = { training: { kcal: 2400, protein: 170, fiber: 30 }, rest: { kcal: 2000, protein: 160, fiber: 30 } }
  const supps = [{ id: 's1', name: 'Creatine' }]

  test('every kind keeps its value as put; the same key under two kinds is two rows', async () => {
    const s = make()
    await s.put({ kind: 'routine', key: 'supplements', baseTs: 1, value: r1, t: 1 })
    await s.put({ kind: 'nutritionDay', key: '2026-11-09', baseTs: null, value: day, t: 2 })
    await s.put({ kind: 'setting', key: 'nutritionTargets', baseTs: 7, value: targets, t: 3 })
    await s.put({ kind: 'setting', key: 'supplements', baseTs: null, value: supps, t: 4 })
    await s.put({ kind: 'nutritionDay', key: '2026-11-08', baseTs: null, value: {}, t: 5 })
    expect(await s.get('nutritionDay', '2026-11-09')).toEqual({ kind: 'nutritionDay', key: '2026-11-09', baseTs: null, value: day, sent: null, t: 2 })
    expect(await s.get('setting', 'supplements')).toEqual({ kind: 'setting', key: 'supplements', baseTs: null, value: supps, sent: null, t: 4 })
    expect((await s.get('routine', 'supplements')).value).toEqual(r1)
    expect((await s.get('nutritionDay', '2026-11-08')).value).toEqual({})
    expect(await s.get('nutritionDay', 'supplements')).toBeNull()
    await s.markAcked([{ kind: 'nutritionDay', key: '2026-11-08', t: 5 }], 'a')
    expect((await s.listPending()).map(e => [e.kind, e.key])).toEqual([
      ['routine', 'supplements'], ['nutritionDay', '2026-11-09'], ['setting', 'nutritionTargets'], ['setting', 'supplements'],
    ])
  })

  test('listPending({ kind }) lists that kind only, in t order', async () => {
    const s = make()
    await s.put({ kind: 'setting', key: 'supplements', baseTs: null, value: supps, t: 9 })
    await s.put({ kind: 'routine', key: 'r1', baseTs: 1, value: r1, t: 1 })
    await s.put({ kind: 'nutritionDay', key: '2026-11-09', baseTs: null, value: day, t: 3 })
    await s.put({ kind: 'setting', key: 'nutritionTargets', baseTs: null, value: targets, t: 2 })
    expect((await s.listPending({ kind: 'routine' })).map(e => e.key)).toEqual(['r1'])
    expect((await s.listPending({ kind: 'nutritionDay' })).map(e => e.key)).toEqual(['2026-11-09'])
    expect((await s.listPending({ kind: 'setting' })).map(e => e.key)).toEqual(['nutritionTargets', 'supplements'])
    expect((await s.listPending()).map(e => e.key)).toEqual(['r1', 'nutritionTargets', '2026-11-09', 'supplements'])
    expect((await s.listPending({})).map(e => e.key)).toEqual(['r1', 'nutritionTargets', '2026-11-09', 'supplements'])
  })

  test('markSent, rebase, markSuperseded and dismiss act on their own kind only', async () => {
    const s = make()
    await s.put({ kind: 'routine', key: 'nutritionTargets', baseTs: 1, value: r1, t: 1 })
    await s.put({ kind: 'setting', key: 'nutritionTargets', baseTs: 1, value: targets, t: 1 })
    await s.markSent([{ kind: 'setting', key: 'nutritionTargets', baseTs: 1, value: { sent: true } }])
    expect((await s.get('routine', 'nutritionTargets')).sent).toBeNull()
    await s.rebase([{ kind: 'setting', key: 'nutritionTargets', t: 1, baseTs: 5 }])
    expect(await s.get('routine', 'nutritionTargets')).toMatchObject({ baseTs: 1 })
    expect(await s.get('setting', 'nutritionTargets')).toMatchObject({ baseTs: 5, sent: null })
    await s.markSuperseded([{ kind: 'routine', key: 'nutritionTargets', t: 1, reason: 'changed' }], 'x')
    expect((await s.listPending()).map(e => e.kind)).toEqual(['setting'])
    await s.markSuperseded([{ kind: 'setting', key: 'nutritionTargets', t: 1, reason: 'changed' }], 'y')
    await s.dismiss('setting', 'nutritionTargets')
    expect((await s.listNotices()).map(n => n.kind)).toEqual(['routine'])
  })

  test('listNotices names a day by its key and a setting by its key, and lists one kind when asked', async () => {
    const s = make()
    await s.put({ kind: 'nutritionDay', key: '2026-11-09', baseTs: 4, value: day, t: 1 })
    await s.put({ kind: 'setting', key: 'nutritionTargets', baseTs: 4, value: targets, t: 2 })
    await s.put({ kind: 'routine', key: 'r1', baseTs: 4, value: r1, t: 3 })
    await s.markSuperseded([{ kind: 'nutritionDay', key: '2026-11-09', t: 1, reason: 'changed' }], '2026-02-01')
    await s.markSuperseded([{ kind: 'setting', key: 'nutritionTargets', t: 2, reason: 'changed' }], '2026-02-02')
    await s.markSuperseded([{ kind: 'routine', key: 'r1', t: 3, reason: 'deleted' }], '2026-02-03')
    expect(await s.listNotices()).toEqual([
      { kind: 'nutritionDay', key: '2026-11-09', name: '2026-11-09', reason: 'changed', at: '2026-02-01' },
      { kind: 'setting', key: 'nutritionTargets', name: 'nutritionTargets', reason: 'changed', at: '2026-02-02' },
      { kind: 'routine', key: 'r1', name: 'Push', reason: 'deleted', at: '2026-02-03' },
    ])
    expect((await s.listNotices({ kind: 'routine' })).map(n => n.key)).toEqual(['r1'])
    expect((await s.listNotices({ kind: 'setting' })).map(n => n.key)).toEqual(['nutritionTargets'])
  })

  test('a kind the store does not know, and a value its kind cannot hold, throw', async () => {
    const s = make()
    await expect(s.put({ key: 'a', baseTs: 1, value: r1, t: 1 })).rejects.toThrow()
    await expect(s.put({ kind: 'workout', key: 'a', baseTs: 1, value: r1, t: 1 })).rejects.toThrow()
    await expect(s.put({ kind: 'nutritionDay', key: '2026-11-09', baseTs: null, value: [], t: 1 })).rejects.toThrow()
    await expect(s.put({ kind: 'nutritionDay', key: '2026-11-09', baseTs: null, value: null, t: 1 })).rejects.toThrow()
    await expect(s.put({ kind: 'setting', key: 'supplements', baseTs: null, value: undefined, t: 1 })).rejects.toThrow()
    await expect(s.put({ kind: 'setting', key: 'supplements', baseTs: null, value: null, t: 1 })).rejects.toThrow()
    await expect(s.put({ kind: 'setting', key: 'supplements', baseTs: null, value: 3, t: 1 })).rejects.toThrow()
    expect(await s.listPending()).toEqual([])
  })

  // A setting row replaces state[key] whole in a push: only the two the Nutrition screen owns.
  test('a setting key other than nutritionTargets or supplements throws, and nothing is stored', async () => {
    const s = make()
    for (const key of ['k', 'routines', 'nutritionDays', 'edited', 'deleted', 'unit', 'workouts', '__proto__']) {
      await expect(s.put({ kind: 'setting', key, baseTs: null, value: {}, t: 1 }), key).rejects.toThrow(/setting/)
    }
    expect(await s.listPending()).toEqual([])
    await s.put({ kind: 'setting', key: 'nutritionTargets', baseTs: null, value: {}, t: 2 })
    await s.put({ kind: 'setting', key: 'supplements', baseTs: null, value: [], t: 3 })
    expect((await s.listPending()).map(e => e.key)).toEqual(['nutritionTargets', 'supplements'])
  })

  // The routines' order (edit-guard.js): every routine id as the phone lists them, under one key.
  test('a routineOrder row holds a list of routine ids under the key routineOrder; anything else throws, and nothing is stored', async () => {
    const s = make()
    for (const value of [{}, { 0: 'a' }, 'a', null, undefined, [1], ['a', null], [['a']]]) {
      await expect(s.put({ kind: 'routineOrder', key: 'routineOrder', baseTs: null, value, t: 1 }), JSON.stringify(value)).rejects.toThrow(/routineOrder/)
    }
    for (const key of ['order', 'routines', 'r1']) {
      await expect(s.put({ kind: 'routineOrder', key, baseTs: null, value: ['a'], t: 1 }), key).rejects.toThrow(/routineOrder/)
    }
    expect(await s.listPending()).toEqual([])
    await s.put({ kind: 'routineOrder', key: 'routineOrder', baseTs: 5, value: ['b', 'a'], t: 2 })
    expect(await s.listPending()).toEqual([{ kind: 'routineOrder', key: 'routineOrder', baseTs: 5, value: ['b', 'a'], sent: null, t: 2 }])
    await s.markSent([{ kind: 'routineOrder', key: 'routineOrder', t: 2, baseTs: 5, value: ['b', 'a', 'c'] }])
    expect((await s.get('routineOrder', 'routineOrder')).sent).toEqual(['b', 'a', 'c'])
  })

  // The schedule (edit-guard.js): all five keys, under the one key schedule. week and dayPlan are maps.
  test('a schedule row holds all five keys under the key schedule; a missing key, a non-map week or dayPlan, or another key throws, and nothing is stored', async () => {
    const s = make()
    const good = { scheduleMode: null, rotation: null, queue: null, week: { 1: ['a'] }, dayPlan: { '2026-11-12': 'rest' } }
    for (const key of ['scheduleMode', 'rotation', 'queue', 'week', 'dayPlan']) {
      const value = { ...good }
      delete value[key]
      await expect(s.put({ kind: 'schedule', key: 'schedule', baseTs: null, value, t: 1 }), key).rejects.toThrow(/schedule/)
    }
    for (const value of [
      { ...good, week: [] }, { ...good, week: null }, { ...good, week: 'mon' },
      { ...good, dayPlan: [] }, { ...good, dayPlan: null },
      null, [], 'week',
    ]) {
      await expect(s.put({ kind: 'schedule', key: 'schedule', baseTs: null, value, t: 1 }), JSON.stringify(value)).rejects.toThrow(/schedule/)
    }
    for (const key of ['week', 'rotation', 'scheduleMode', 'queue', 'dayPlan']) {
      await expect(s.put({ kind: 'schedule', key, baseTs: null, value: good, t: 1 }), key).rejects.toThrow(/schedule/)
    }
    expect(await s.listPending()).toEqual([])
    await s.put({ kind: 'schedule', key: 'schedule', baseTs: 5, value: good, t: 2 })
    expect(await s.listPending()).toEqual([{ kind: 'schedule', key: 'schedule', baseTs: 5, value: good, sent: null, t: 2 }])
    const sent = { ...good, scheduleMode: 'week' }
    await s.markSent([{ kind: 'schedule', key: 'schedule', t: 2, baseTs: 5, value: sent }])
    expect((await s.get('schedule', 'schedule')).sent).toEqual(sent)
  })

  // A custom exercise (edit-guard.js): any string key, a map value. The delete marker is a map.
  test('a customEx row holds a map under any string key, and a non-map is refused', async () => {
    const s = make()
    for (const value of [null, [], 'Curl', 1, undefined, true]) {
      await expect(s.put({ kind: 'customEx', key: 'c1', baseTs: 0, value, t: 1 }), JSON.stringify(value)).rejects.toThrow(/customEx/)
    }
    expect(await s.listPending()).toEqual([])
    const curl = { id: 'c1', n: 'Curl', bp: 'arms' }
    await s.put({ kind: 'customEx', key: 'c1', baseTs: 0, value: curl, t: 2 })
    await s.put({ kind: 'customEx', key: 'deleted-id', baseTs: null, value: { deleted: true }, t: 3 })
    expect(await s.listPending()).toEqual([
      { kind: 'customEx', key: 'c1', baseTs: 0, value: curl, sent: null, t: 2 },
      { kind: 'customEx', key: 'deleted-id', baseTs: null, value: { deleted: true }, sent: null, t: 3 },
    ])
  })

  test('listNotices names a custom exercise by n when that is a string, and by an empty name otherwise', async () => {
    const s = make()
    await s.put({ kind: 'customEx', key: 'c1', baseTs: 1, value: { id: 'c1', n: 'Curl' }, t: 1 })
    await s.put({ kind: 'customEx', key: 'c2', baseTs: 1, value: { id: 'c2', n: 5 }, t: 2 })
    await s.put({ kind: 'customEx', key: 'c3', baseTs: 1, value: { deleted: true }, t: 3 })
    await s.put({ kind: 'routine', key: 'r1', baseTs: 1, value: r1, t: 4 })
    await s.markSuperseded([{ kind: 'customEx', key: 'c1', t: 1, reason: 'changed' }], '2026-02-01')
    await s.markSuperseded([{ kind: 'customEx', key: 'c2', t: 2, reason: 'deleted' }], '2026-02-02')
    await s.markSuperseded([{ kind: 'customEx', key: 'c3', t: 3, reason: 'unsafe' }], '2026-02-03')
    await s.markSuperseded([{ kind: 'routine', key: 'r1', t: 4, reason: 'changed' }], '2026-02-04')
    expect(await s.listNotices()).toEqual([
      { kind: 'customEx', key: 'c1', name: 'Curl', reason: 'changed', at: '2026-02-01' },
      { kind: 'customEx', key: 'c2', name: '', reason: 'deleted', at: '2026-02-02' },
      { kind: 'customEx', key: 'c3', name: '', reason: 'unsafe', at: '2026-02-03' },
      { kind: 'routine', key: 'r1', name: 'Push', reason: 'changed', at: '2026-02-04' },
    ])
    expect((await s.listNotices({ kind: 'customEx' })).map(n => n.key)).toEqual(['c1', 'c2', 'c3'])
  })

  // A delete over a create still in flight must not keep that create's sent value (ruling: fresh).
  test('a fresh customEx delete does not keep a create that is still in flight', async () => {
    const s = make()
    const made = { id: 'c1', n: 'Curl' }
    await s.put({ kind: 'customEx', key: 'c1', baseTs: 0, value: made, t: 1 })
    await s.markSent([{ kind: 'customEx', key: 'c1', baseTs: 0, value: made }])
    await s.put({ kind: 'customEx', key: 'c1', baseTs: null, value: { deleted: true }, t: 2, fresh: true })
    expect(await s.get('customEx', 'c1')).toEqual({ kind: 'customEx', key: 'c1', baseTs: null, value: { deleted: true }, sent: null, t: 2 })
  })
})

test('real sqlite: survives a reopen with value and sent as objects', async () => {
  let db = createNodeSqliteFileDb()
  const s = createSqlitePendingEdits(db)
  await s.put({ kind: 'routine', key: 'r1', baseTs: null, value: r1, t: 5 })
  await s.markSent([{ kind: 'routine', key: 'r1', t: 5, value: r1 }])
  db = db.reopen()
  expect(await createSqlitePendingEdits(db).get('routine', 'r1')).toEqual({ kind: 'routine', key: 'r1', baseTs: null, value: r1, sent: r1, t: 5 })
})

test('real sqlite: a markSent landing while a put is on its way in is kept, since one statement reads and writes the row', async () => {
  const db = createNodeSqliteDb()
  const s = createSqlitePendingEdits(db)
  await s.put({ kind: 'routine', key: 'r1', baseTs: 1, value: r1, t: 5 })
  db.holdNext(/^INSERT INTO pending_edits/)
  const put = s.put({ kind: 'routine', key: 'r1', baseTs: 1, value: { ...r1, name: 'Pull' }, t: 6 })
  await db.held()
  await s.markSent([{ kind: 'routine', key: 'r1', baseTs: 1, value: r1 }])
  db.release()
  expect(await put).toEqual({ ok: true, kind: 'routine', key: 'r1', t: 6 })
  expect(await s.get('routine', 'r1')).toEqual({ kind: 'routine', key: 'r1', baseTs: 1, value: { ...r1, name: 'Pull' }, sent: r1, t: 6 })
})

test('two stores on one db migrate once', async () => {
  const db = createNodeSqliteDb()
  const stores = [createSqlitePendingEdits(db), createSqlitePendingEdits(db)]
  await Promise.all(stores.map(s => s.listPending()))
  expect(db.executed.filter(sql => /CREATE TABLE IF NOT EXISTS pending_edits/.test(sql))).toHaveLength(1)
})

test('sqlite store needs a db handle', () => {
  expect(() => createSqlitePendingEdits({})).toThrow()
})
