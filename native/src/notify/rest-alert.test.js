import { describe, expect, test } from 'vitest'
import { SQLITE_DRIVERS } from '../../scripts/node-sqlite.mjs'
import { plannedSetId } from '../session/ids.js'
import { openSession } from '../session/session.js'
import { createSqliteSessionStorage } from '../session/sqlite-storage.js'
import { createMemoryStorage } from '../session/storage.js'
import { pendingRest } from '../workout/rest-after.js'
import { resumeRestCall } from '../workout/set-calls.js'
import {
  alertStatus,
  deliveredToDismiss,
  desiredRestAlert,
  foregroundBehavior,
  isRestAlertResponse,
  nextSetLabel,
  planRestAlerts,
  restAlertPossible,
  reconcileRestAlerts,
  restAlertId,
} from './rest-alert.js'

const T0 = Date.parse('2026-11-07T15:00:00.000Z')
const names = { bench: { name: 'Bench press', category: 'chest' }, fly: { name: 'Cable fly', category: 'chest' } }
const base = () => ({
  id: 's1', d: '2026-11-07', start: T0, name: 'Push', routineIds: ['r1'],
  entries: [
    { id: 'bench', target: { sets: 2, reps: 5 }, sets: [{ w: 60, r: 5, done: false }, { w: 60, r: 5, done: false }] },
    { id: 'fly', target: { sets: 1, reps: 12 }, sets: [{ w: 10, r: 12, done: false }] },
  ],
})

const running = (deadline, totalMs = 90_000) => ({ status: 'running', deadline, totalMs, remainingMs: totalMs })
const alertFor = (sessionId, deadline, body = 'Next: Bench press, set 2') => ({
  identifier: `rest-${sessionId}`,
  date: deadline,
  title: 'Rest over',
  body,
  data: { kind: 'rest', sessionId, deadline },
})
// A pending request as the adapter lists it.
const pending = ({ identifier, title, body, data }) => ({ identifier, title, body, data })

// Behaves as iOS does: scheduling an identifier already pending replaces that request.
function fakeAdapter({ scheduled = [], delivered = [] } = {}) {
  const state = { scheduled: scheduled.map(pending), delivered: delivered.slice(), calls: [] }
  return {
    state,
    listScheduled: async () => state.scheduled.map(r => ({ ...r })),
    schedule: async request => {
      state.calls.push(['schedule', request.identifier])
      state.scheduled = state.scheduled.filter(r => r.identifier !== request.identifier).concat({ ...pending(request), date: request.date })
    },
    cancel: async id => {
      state.calls.push(['cancel', id])
      state.scheduled = state.scheduled.filter(r => r.identifier !== id)
    },
    listDelivered: async () => state.delivered.map(n => ({ ...n })),
    dismiss: async id => {
      state.calls.push(['dismiss', id])
      state.delivered = state.delivered.filter(n => n.identifier !== id)
    },
  }
}

describe('desiredRestAlert', () => {
  const now = T0 + 10_000

  test('a running rest in an active session asks for one alert at its deadline', () => {
    const rest = running(T0 + 90_000)
    expect(desiredRestAlert({ sessionId: 's1', status: 'active', rest, now, nextLabel: 'Next: Bench press, set 2' }))
      .toEqual(alertFor('s1', T0 + 90_000))
  })

  test('with no set left it sends the owner back to the workout', () => {
    const alert = desiredRestAlert({ sessionId: 's1', status: 'active', rest: running(T0 + 90_000), now, nextLabel: null })
    expect(alert.body).toBe('Back to your workout')
  })

  test('the identifier is the session base id', () => {
    expect(restAlertId('abc')).toBe('rest-abc')
  })

  test('no alert for a paused, complete or missing rest', () => {
    const paused = { status: 'paused', deadline: T0 + 70_000, totalMs: 90_000, remainingMs: 60_000 }
    expect(desiredRestAlert({ sessionId: 's1', status: 'active', rest: paused, now })).toBeNull()
    expect(desiredRestAlert({ sessionId: 's1', status: 'active', rest: running(now), now })).toBeNull()
    expect(desiredRestAlert({ sessionId: 's1', status: 'active', rest: running(now - 1), now })).toBeNull()
    expect(desiredRestAlert({ sessionId: 's1', status: 'active', rest: null, now })).toBeNull()
  })

  test('a view drawn while the rest ran is read again at now: a deadline since passed asks for nothing', () => {
    const stale = { status: 'running', deadline: T0 + 5_000, totalMs: 90_000, remainingMs: 1_000 }
    expect(desiredRestAlert({ sessionId: 's1', status: 'active', rest: stale, now })).toBeNull()
  })

  test('no alert outside an active session', () => {
    for (const status of ['finished', 'discarded', 'none', null]) {
      expect(desiredRestAlert({ sessionId: 's1', status, rest: running(T0 + 90_000), now })).toBeNull()
    }
    expect(desiredRestAlert({ sessionId: null, status: 'active', rest: running(T0 + 90_000), now })).toBeNull()
  })
})

describe('planRestAlerts', () => {
  const desired = alertFor('s1', T0 + 90_000)

  test('nothing scheduled: schedule the alert', () => {
    expect(planRestAlerts(desired, [])).toEqual({ cancel: [], schedule: desired })
  })

  test('the same alert already scheduled: nothing to do', () => {
    expect(planRestAlerts(desired, [pending(desired)])).toEqual({ cancel: [], schedule: null })
  })

  test('a different deadline: schedule the new one over it, without cancelling the identifier it replaces', () => {
    const old = pending(alertFor('s1', T0 + 60_000))
    expect(planRestAlerts(desired, [old])).toEqual({ cancel: [], schedule: desired })
  })

  test('the next set changed (an Undo during rest): the alert is rewritten', () => {
    const old = pending(alertFor('s1', T0 + 90_000, 'Next: Bench press, set 1'))
    expect(planRestAlerts(desired, [old])).toEqual({ cancel: [], schedule: desired })
  })

  test("another session's rest alert is cancelled", () => {
    const other = pending(alertFor('s0', T0 + 30_000))
    expect(planRestAlerts(desired, [other, pending(desired)])).toEqual({ cancel: ['rest-s0'], schedule: null })
  })

  test('a request that is not a rest alert is never touched', () => {
    const foreign = { identifier: 'reminder-1', title: 'Leg day', body: '', data: { kind: 'reminder' } }
    expect(planRestAlerts(desired, [foreign])).toEqual({ cancel: [], schedule: desired })
    expect(planRestAlerts(null, [foreign])).toEqual({ cancel: [], schedule: null })
  })

  test('paused, complete or finished (nothing desired): every rest alert is cancelled', () => {
    const foreign = { identifier: 'reminder-1', title: '', body: '', data: null }
    const scheduled = [pending(alertFor('s1', T0 + 90_000)), foreign, pending(alertFor('s0', T0 + 30_000))]
    expect(planRestAlerts(null, scheduled)).toEqual({ cancel: ['rest-s1', 'rest-s0'], schedule: null })
  })
})

describe('deliveredToDismiss', () => {
  const delivered = [
    { identifier: 'rest-s1', data: { kind: 'rest', sessionId: 's1', deadline: T0 } },
    { identifier: 'rest-s0', data: { kind: 'rest', sessionId: 's0', deadline: T0 } },
    { identifier: 'reminder-1', data: null },
  ]

  test('a finished or discarded session takes its delivered rest alert away', () => {
    expect(deliveredToDismiss('s1', delivered, 'finished')).toEqual(['rest-s1'])
    expect(deliveredToDismiss('s1', delivered, 'discarded')).toEqual(['rest-s1'])
  })

  test('no session open: every delivered rest alert goes, and nothing else', () => {
    expect(deliveredToDismiss(null, delivered, 'none')).toEqual(['rest-s1', 'rest-s0'])
    expect(deliveredToDismiss(null, [], 'none')).toEqual([])
  })

  test('an active session keeps what was delivered', () => {
    expect(deliveredToDismiss('s1', delivered, 'active')).toEqual([])
    expect(deliveredToDismiss(null, delivered, 'finished')).toEqual([])
  })
})

describe('alertStatus', () => {
  test('reads the session and its view', () => {
    expect(alertStatus('ready', { status: 'active' })).toBe('active')
    expect(alertStatus('ready', { status: 'finished' })).toBe('finished')
    expect(alertStatus('saved', null)).toBe('finished')
    expect(alertStatus('discarded', { status: 'discarded' })).toBe('discarded')
  })

  test('unknown while opening or after a failed open', () => {
    expect(alertStatus('loading', null)).toBeNull()
    expect(alertStatus('error', null)).toBeNull()
    expect(alertStatus('ready', null)).toBeNull()
  })
})

describe('nextSetLabel', () => {
  const at = T0 + 1000
  const openMemory = () => openSession({ base: base(), storage: createMemoryStorage(), now: () => at, timeZone: 'UTC' })
  const fieldsOf = { bench: { w: 60, r: 5 }, fly: { w: 10, r: 12 } }
  const commit = (session, exerciseId, index, id) =>
    session.commitSet({ eventId: id, exerciseId, setId: plannedSetId(exerciseId, index), fields: fieldsOf[exerciseId] })

  test('names the exercise and set the workout goes to next', async () => {
    const session = await openMemory()
    expect(nextSetLabel(session.view(), names)).toBe('Next: Bench press, set 1')
    await commit(session, 'bench', 0, 'c1')
    expect(nextSetLabel(session.view(), names)).toBe('Next: Bench press, set 2')
    await commit(session, 'bench', 1, 'c2')
    expect(nextSetLabel(session.view(), names)).toBe('Next: Cable fly, set 1')
  })

  test('nothing next once every set is done, or without a view', async () => {
    const session = await openMemory()
    await commit(session, 'bench', 0, 'c1')
    await commit(session, 'bench', 1, 'c2')
    await commit(session, 'fly', 0, 'c3')
    expect(nextSetLabel(session.view(), names)).toBeNull()
    expect(nextSetLabel(null, names)).toBeNull()
  })
})

describe('foreground and tap', () => {
  const REST = { kind: 'rest', sessionId: 's1', deadline: T0 }
  test('a rest alert arriving with the app active is not presented: no banner, list, sound or badge', () => {
    expect(foregroundBehavior(REST, true))
      .toEqual({ shouldShowBanner: false, shouldShowList: false, shouldPlaySound: false, shouldSetBadge: false })
  })

  test('with the app in front but inactive (Control Center, the app switcher) it shows as in the background', () => {
    const shown = { shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }
    expect(foregroundBehavior(REST, false)).toEqual(shown)
    expect(foregroundBehavior(REST, undefined)).toEqual(shown)
  })

  test('any other notification (the app sends none) shows as in the background, active or not', () => {
    const shown = { shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }
    expect(foregroundBehavior(undefined, true)).toEqual(shown)
    expect(foregroundBehavior({ kind: 'reminder' }, false)).toEqual(shown)
  })

  test('a tap is on a rest alert only when its data says so', () => {
    const response = kind => ({ notification: { request: { identifier: 'x', content: { data: { kind } } } } })
    expect(isRestAlertResponse(response('rest'))).toBe(true)
    expect(isRestAlertResponse(response('reminder'))).toBe(false)
    expect(isRestAlertResponse(null)).toBe(false)
  })
})

describe('restAlertPossible', () => {
  const now = T0 + 10_000
  test('only an active session with a running rest could schedule', () => {
    const ok = { sessionId: 's1', status: 'active', view: { rest: running(T0 + 90_000) }, now }
    expect(restAlertPossible(ok)).toBe(true)
    expect(restAlertPossible({ ...ok, status: 'finished' })).toBe(false)
    expect(restAlertPossible({ ...ok, status: 'discarded' })).toBe(false)
    expect(restAlertPossible({ ...ok, status: 'none', sessionId: null })).toBe(false)
    expect(restAlertPossible({ ...ok, status: null })).toBe(false)
    expect(restAlertPossible({ ...ok, view: { rest: { ...running(T0 + 90_000), status: 'paused' } } })).toBe(false)
    expect(restAlertPossible({ ...ok, view: { rest: null } })).toBe(false)
    expect(restAlertPossible({ ...ok, now: T0 + 91_000 })).toBe(false)
  })
})

describe('reconcileRestAlerts', () => {
  const now = T0 + 10_000
  const active = (rest, extra = {}) => ({
    sessionId: 's1', status: 'active', view: { status: 'active', rest }, nextLabel: 'Next: Bench press, set 2', now, permission: 'granted', ...extra,
  })

  test('schedules the alert the journal implies, once', async () => {
    const adapter = fakeAdapter()
    await reconcileRestAlerts({ ...active(running(T0 + 90_000)), adapter })
    await reconcileRestAlerts({ ...active(running(T0 + 90_000)), adapter })
    expect(adapter.state.scheduled).toEqual([{ ...pending(alertFor('s1', T0 + 90_000)), date: T0 + 90_000 }])
    expect(adapter.state.calls).toEqual([['schedule', 'rest-s1']])
  })

  test('a replaced alert is scheduled over, not cancelled first; other sessions are cancelled', async () => {
    const adapter = fakeAdapter({ scheduled: [alertFor('s1', T0 + 60_000), alertFor('s0', T0 + 30_000)] })
    await reconcileRestAlerts({ ...active(running(T0 + 90_000)), adapter })
    expect(adapter.state.calls).toEqual([['cancel', 'rest-s0'], ['schedule', 'rest-s1']])
    expect(adapter.state.scheduled.map(r => r.data.deadline)).toEqual([T0 + 90_000])
  })

  test('without permission it schedules nothing and cancels any rest alert left', async () => {
    const foreign = { identifier: 'reminder-1', title: '', body: '', data: null }
    const adapter = fakeAdapter({ scheduled: [alertFor('s1', T0 + 60_000), foreign] })
    await reconcileRestAlerts({ ...active(running(T0 + 90_000)), permission: 'off', adapter })
    expect(adapter.state.scheduled).toEqual([foreign])
  })

  test('an unknown session state touches nothing', async () => {
    const adapter = fakeAdapter({ scheduled: [alertFor('s1', T0 + 60_000)] })
    await reconcileRestAlerts({ ...active(running(T0 + 90_000)), status: null, adapter })
    expect(adapter.state.calls).toEqual([])
  })

  test('finished or discarded: no rest alert stays scheduled, and its delivered alert is taken away', async () => {
    for (const status of ['finished', 'discarded']) {
      const delivered = [{ identifier: 'rest-s1', data: { kind: 'rest' } }, { identifier: 'rest-s0', data: { kind: 'rest' } }]
      const adapter = fakeAdapter({ scheduled: [alertFor('s1', T0 + 90_000)], delivered })
      await reconcileRestAlerts({ ...active(null), status, view: null, adapter })
      expect(adapter.state.scheduled).toEqual([])
      expect(adapter.state.delivered.map(n => n.identifier)).toEqual(['rest-s0'])
    }
  })

  test('no session open: every rest alert is cancelled', async () => {
    const adapter = fakeAdapter({ scheduled: [alertFor('s1', T0 + 90_000)] })
    await reconcileRestAlerts({ sessionId: null, status: 'none', view: null, nextLabel: null, now, adapter })
    expect(adapter.state.scheduled).toEqual([])
  })

  test('no session open: every delivered rest alert is dismissed too', async () => {
    const delivered = [{ identifier: 'rest-s1', data: { kind: 'rest' } }, { identifier: 'reminder-1', data: null }]
    const adapter = fakeAdapter({ delivered })
    await reconcileRestAlerts({ sessionId: null, status: 'none', view: null, nextLabel: null, now, adapter })
    expect(adapter.state.delivered.map(n => n.identifier)).toEqual(['reminder-1'])
  })

  test('an adapter error reaches the caller', async () => {
    const adapter = { ...fakeAdapter(), listScheduled: async () => { throw new Error('no center') } }
    await expect(reconcileRestAlerts({ ...active(running(T0 + 90_000)), adapter })).rejects.toThrow('no center')
  })
})

describe('reconcile against the real journal', () => {
  const open = (db, nowMs) => openSession({ base: base(), storage: createSqliteSessionStorage(db), now: () => nowMs, timeZone: 'UTC' })
  const reconcileAt = (session, now, adapter) => {
    const view = session.view()
    return reconcileRestAlerts({ sessionId: 's1', status: view.status, view, nextLabel: nextSetLabel(view, names), now, adapter, permission: 'granted' })
  }

  test.each(SQLITE_DRIVERS)('%s: killed between the rest write and the schedule, the next launch schedules exactly one alert', async (_n, createDb) => {
    let db = createDb()
    const t = T0 + 1000
    const first = await open(db, t)
    await first.commitSet({ eventId: 'c1', exerciseId: 'bench', setId: plannedSetId('bench', 0), fields: { w: 60, r: 5 } })
    await first.startRest(pendingRest(first.view(), t, () => 90_000))
    // Killed here: the rest is in the journal, nothing was scheduled.
    db = db.reopen()
    const adapter = fakeAdapter()
    const second = await open(db, t + 5000)
    await reconcileAt(second, t + 5000, adapter)
    expect(adapter.state.scheduled).toEqual([{
      identifier: 'rest-s1',
      title: 'Rest over',
      body: 'Next: Bench press, set 2',
      data: { kind: 'rest', sessionId: 's1', deadline: t + 90_000 },
      date: t + 90_000,
    }])
    // Every later reconcile (return to the app, the next write) leaves that one request.
    await reconcileAt(second, t + 6000, adapter)
    expect(adapter.state.scheduled).toHaveLength(1)
    expect(adapter.state.calls).toEqual([['schedule', 'rest-s1']])
  })

  test.each(SQLITE_DRIVERS)('%s: pause cancels the alert; resume after a kill schedules it at the resumed deadline', async (_n, createDb) => {
    let db = createDb()
    const t = T0 + 1000
    let clock = t
    const session = await openSession({ base: base(), storage: createSqliteSessionStorage(db), now: () => clock, timeZone: 'UTC' })
    await session.commitSet({ eventId: 'c1', exerciseId: 'bench', setId: plannedSetId('bench', 0), fields: { w: 60, r: 5 } })
    await session.startRest(pendingRest(session.view(), t, () => 90_000))
    const adapter = fakeAdapter()
    await reconcileAt(session, clock, adapter)
    expect(adapter.state.scheduled.map(r => r.data.deadline)).toEqual([t + 90_000])

    clock = t + 30_000
    await session.pauseRest({ eventId: 'p1' })
    await reconcileAt(session, clock, adapter)
    expect(adapter.state.scheduled).toEqual([])

    db = db.reopen()
    const resumeAt = t + 200_000
    const reopened = await open(db, resumeAt)
    await reopened.startRest(resumeRestCall(reopened.view(), resumeAt, 'r1'))
    await reconcileAt(reopened, resumeAt, adapter)
    expect(adapter.state.scheduled.map(r => r.data.deadline)).toEqual([resumeAt + 60_000])
  })
})
