import { afterEach, describe, expect, test, vi } from 'vitest'
import { ASK_WAIT_MS, createRestAlerts } from './rest-alerts-core.js'

const NOW = Date.parse('2026-11-07T15:00:00.000Z')
const DEADLINE = NOW + 90_000
const running = { status: 'running', deadline: DEADLINE, totalMs: 90_000, remainingMs: 90_000 }
const journal = (status, rest = running, sessionId = 's1') => () => ({ sessionId, status, view: { status, rest }, nextLabel: 'Next: Bench press, set 2' })
const NONE = () => ({ sessionId: null, status: 'none', view: null, nextLabel: null })
const stale = { identifier: 'rest-s0', title: 'Rest over', body: 'x', data: { kind: 'rest', sessionId: 's0', deadline: NOW + 5000 } }
const granted = { status: 'granted', granted: true, ios: { status: 2 } }
const ask = { status: 'undetermined', granted: false, ios: { status: 0 } }

function fakeAdapter({ permissions = async () => granted, request = async () => granted, scheduled = [stale] } = {}) {
  const state = { scheduled: scheduled.slice(), requests: [], reads: 0 }
  return {
    state,
    permissions: async () => { state.reads += 1; return permissions() },
    request: async options => { state.requests.push(options); return request() },
    listScheduled: async () => state.scheduled.map(r => ({ ...r })),
    schedule: async r => { state.scheduled = state.scheduled.filter(x => x.identifier !== r.identifier).concat({ identifier: r.identifier, title: r.title, body: r.body, data: r.data }) },
    cancel: async id => { state.scheduled = state.scheduled.filter(r => r.identifier !== id) },
    listDelivered: async () => [],
    dismiss: async () => {},
  }
}
const make = adapter => createRestAlerts({ adapter, now: () => NOW + 1000 })
const ids = adapter => adapter.state.scheduled.map(r => r.identifier)

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('a permission read that rejects still cancels', () => {
  const rejects = async () => { throw new Error('no center') }

  test('with a rest running it counts as off: the stale alert goes, nothing is scheduled', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const adapter = fakeAdapter({ permissions: rejects })
    await make(adapter).reconcile(journal('active'))
    expect(adapter.state.reads).toBe(1)
    expect(ids(adapter)).toEqual([])
  })

  test.each([
    ['finished', journal('finished')],
    ['discarded', journal('discarded')],
    ['paused', journal('active', { ...running, status: 'paused', remainingMs: 40_000 })],
    ['no session', NONE],
  ])('%s: cancels without reading permission', async (_n, read) => {
    const adapter = fakeAdapter({ permissions: rejects })
    await make(adapter).reconcile(read)
    expect(adapter.state.reads).toBe(0)
    expect(ids(adapter)).toEqual([])
  })

  test('clear cancels with no session open', async () => {
    const adapter = fakeAdapter({ permissions: rejects })
    await make(adapter).clear()
    expect(ids(adapter)).toEqual([])
  })
})

describe('a granted read schedules', () => {
  test('one alert at the deadline, the stale one cancelled', async () => {
    const adapter = fakeAdapter()
    await make(adapter).reconcile(journal('active'))
    expect(ids(adapter)).toEqual(['rest-s1'])
    expect(adapter.state.scheduled[0].data.deadline).toBe(DEADLINE)
  })

  test('denied schedules nothing', async () => {
    const adapter = fakeAdapter({ permissions: async () => ({ status: 'denied', granted: false, ios: { status: 1 } }) })
    await make(adapter).reconcile(journal('active'))
    expect(ids(adapter)).toEqual([])
  })
})

describe('asking when a rest starts', () => {
  test('asks once with the alert options, then the running rest gets its alert', async () => {
    let current = ask
    const adapter = fakeAdapter({ permissions: async () => current })
    adapter.request = vi.fn(async () => { current = granted; return granted })
    const alerts = make(adapter)
    expect(await alerts.reconcile(journal('active'), { restStarted: true })).toEqual({ step: 'granted', asked: true })
    expect(adapter.request).toHaveBeenCalledTimes(1)
    expect(adapter.request).toHaveBeenCalledWith({ ios: { allowAlert: true, allowSound: true, allowBadge: false } })
    await alerts.reconcile(journal('active'))
    expect(ids(adapter)).toEqual(['rest-s1'])
    await alerts.reconcile(journal('active'), { restStarted: true })
    expect(adapter.request).toHaveBeenCalledTimes(1)
  })

  test('never asks without a rest start', async () => {
    const adapter = fakeAdapter({ permissions: async () => ask })
    adapter.request = vi.fn(async () => granted)
    await make(adapter).reconcile(journal('active'))
    expect(adapter.request).not.toHaveBeenCalled()
  })

  test('a prompt that never answers: the write waits the bounded time, then counts as off', async () => {
    vi.useFakeTimers()
    const adapter = fakeAdapter({ permissions: async () => ask, request: () => new Promise(() => {}) })
    const alerts = make(adapter)
    let result
    alerts.reconcile(journal('active'), { restStarted: true }).then(r => { result = r })
    await vi.advanceTimersByTimeAsync(ASK_WAIT_MS - 1)
    expect(result).toBeUndefined()
    await vi.advanceTimersByTimeAsync(1)
    expect(result).toEqual({ step: 'off', asked: false })
  })

  test('the unanswered prompt does not block the queue', async () => {
    vi.useFakeTimers()
    const adapter = fakeAdapter({ permissions: async () => ask, request: () => new Promise(() => {}) })
    const alerts = make(adapter)
    alerts.reconcile(journal('active'), { restStarted: true })
    let later = false
    alerts.reconcile(journal('finished')).then(() => { later = true })
    await vi.advanceTimersByTimeAsync(0)
    expect(later).toBe(true)
  })

  test('an answer after the wait still reconciles, and is not asked for again', async () => {
    vi.useFakeTimers()
    let answer
    let current = ask
    const adapter = fakeAdapter({ permissions: async () => current, request: () => new Promise(resolve => { answer = resolve }) })
    const alerts = make(adapter)
    alerts.reconcile(journal('active'), { restStarted: true })
    await vi.advanceTimersByTimeAsync(ASK_WAIT_MS)
    expect(ids(adapter)).toEqual([])
    current = granted
    answer(granted)
    await vi.advanceTimersByTimeAsync(0)
    expect(ids(adapter)).toEqual(['rest-s1'])
    await alerts.reconcile(journal('active'), { restStarted: true })
    expect(adapter.state.requests).toHaveLength(1)
  })

  test('a request that rejects is off and asked', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const adapter = fakeAdapter({ permissions: async () => ask, request: async () => { throw new Error('boom') } })
    expect(await make(adapter).reconcile(journal('active'), { restStarted: true })).toEqual({ step: 'off', asked: true })
  })
})
