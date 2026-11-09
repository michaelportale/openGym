import { afterEach, describe, expect, test, vi } from 'vitest'
import { ASK_WAIT_MS, JOB_WAIT_MS, createRestAlerts, restStartWaits } from './rest-alerts-core.js'

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
// Hangs the adapter call `name` the first time it is made from here on; later calls work.
const hangOnce = (adapter, name) => {
  const real = adapter[name]
  let calls = 0
  adapter[name] = (...args) => (++calls === 1 ? new Promise(() => {}) : real(...args))
}
const denied = { status: 'denied', granted: false, ios: { status: 1 } }
const paused = { ...running, status: 'paused', remainingMs: 40_000 }

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

  test('a second rest start while the first prompt is still up never asks again', async () => {
    vi.useFakeTimers()
    const adapter = fakeAdapter({ permissions: async () => ask, request: () => new Promise(() => {}) })
    const alerts = make(adapter)
    alerts.reconcile(journal('active'), { restStarted: true })
    alerts.reconcile(journal('active'), { restStarted: true })
    await vi.advanceTimersByTimeAsync(0)
    expect(adapter.state.requests).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(ASK_WAIT_MS)
    expect(adapter.state.requests).toHaveLength(1)
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

describe('a native call that never settles', () => {
  test('the job times out after JOB_WAIT_MS and warns, and the queue moves on', async () => {
    vi.useFakeTimers()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const adapter = fakeAdapter()
    hangOnce(adapter, 'listScheduled')
    const alerts = make(adapter)
    let first
    let second
    alerts.reconcile(journal('active')).then(r => { first = r })
    alerts.reconcile(journal('active')).then(r => { second = r })
    await vi.advanceTimersByTimeAsync(JOB_WAIT_MS - 1)
    expect(first).toBeUndefined()
    expect(second).toBeUndefined()
    await vi.advanceTimersByTimeAsync(1)
    expect(first).toBeNull()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][1])).toMatch(/timed out/)
    await vi.advanceTimersByTimeAsync(0)
    expect(second).toEqual({ step: 'granted', asked: false })
    expect(ids(adapter)).toEqual(['rest-s1'])
  })

  test('a rest start whose permission read hangs is answered once the job times out', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const adapter = fakeAdapter({ permissions: () => new Promise(() => {}) })
    let answer
    make(adapter).reconcile(journal('active'), { restStarted: true }).then(r => { answer = r })
    await vi.advanceTimersByTimeAsync(JOB_WAIT_MS - 1)
    expect(answer).toBeUndefined()
    await vi.advanceTimersByTimeAsync(1)
    expect(answer).toBeNull()
  })

  test('a job that timed out can never change the schedule afterwards; the newer job stands', async () => {
    vi.useFakeTimers()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const shown = { identifier: 'rest-s1', title: 'Rest over', body: 'x', data: { kind: 'rest', sessionId: 's1', deadline: DEADLINE } }
    const adapter = fakeAdapter({ scheduled: [shown] })
    // The first list answers only when released, long after its job timed out.
    const real = adapter.listScheduled
    let release
    let calls = 0
    adapter.listScheduled = () => (++calls === 1 ? new Promise(resolve => { release = () => resolve(real()) }) : real())
    let status = 'active'
    const read = () => journal(status)()
    const alerts = make(adapter)
    alerts.reconcile(read)
    await vi.advanceTimersByTimeAsync(JOB_WAIT_MS)
    // Finished: the newer job cancels the alert.
    status = 'finished'
    await alerts.reconcile(read)
    expect(ids(adapter)).toEqual([])
    // The abandoned job wakes with its old "active, rest running" snapshot and would schedule it.
    release()
    await vi.advanceTimersByTimeAsync(0)
    expect(ids(adapter)).toEqual([])
    expect(warn.mock.calls.some(call => /timed out/.test(String(call[0]) + String(call[1])))).toBe(true)
  })

  test('a run abandoned while it read permission never shows the prompt late; the next rest start asks', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    let release
    let calls = 0
    const adapter = fakeAdapter({ permissions: () => (++calls === 1 ? new Promise(resolve => { release = () => resolve(ask) }) : Promise.resolve(ask)) })
    adapter.request = vi.fn(() => new Promise(() => {}))
    const alerts = make(adapter)
    alerts.reconcile(journal('active'), { restStarted: true })
    await vi.advanceTimersByTimeAsync(JOB_WAIT_MS)
    release()
    await vi.advanceTimersByTimeAsync(0)
    expect(adapter.request).not.toHaveBeenCalled()
    alerts.reconcile(journal('active'), { restStarted: true })
    await vi.advanceTimersByTimeAsync(0)
    expect(adapter.request).toHaveBeenCalledTimes(1)
  })

  test('a live job that is slow but within JOB_WAIT_MS still schedules', async () => {
    vi.useFakeTimers()
    const adapter = fakeAdapter()
    const real = adapter.listScheduled
    adapter.listScheduled = () => new Promise(resolve => setTimeout(() => resolve(real()), JOB_WAIT_MS - 1))
    let done
    make(adapter).reconcile(journal('active')).then(r => { done = r })
    await vi.advanceTimersByTimeAsync(JOB_WAIT_MS - 1)
    expect(done).toEqual({ step: 'granted', asked: false })
    expect(ids(adapter)).toEqual(['rest-s1'])
  })

  test('a job that settles in time leaves no timer behind', async () => {
    vi.useFakeTimers()
    await make(fakeAdapter()).reconcile(journal('active'))
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('only the rest start that may ask waits for its reconcile', () => {
  test.each([
    [null, false, true],
    [null, true, true],
    ['ask', false, true],
    ['ask', true, false],
    ['granted', false, false],
    ['granted', true, false],
    ['off', false, false],
    ['off', true, false],
  ])('step %s, asked %s: waits %s', (known, asked, waits) => {
    expect(restStartWaits(known, asked)).toBe(waits)
  })

  test('once the prompt was answered, a rest start is answered at once, even while its reconcile hangs', async () => {
    vi.useFakeTimers()
    let current = ask
    const adapter = fakeAdapter({ permissions: async () => current, request: async () => { current = granted; return granted } })
    const alerts = make(adapter)
    expect(await alerts.reconcile(journal('active'), { restStarted: true })).toEqual({ step: 'granted', asked: true })
    hangOnce(adapter, 'listScheduled')
    let answer
    alerts.reconcile(journal('active'), { restStarted: true }).then(r => { answer = r })
    await vi.advanceTimersByTimeAsync(0)
    expect(answer).toEqual({ step: 'granted', asked: false })
  })

  test('alerts read as off on open: a rest start is answered off at once, and the reconcile still runs', async () => {
    vi.useFakeTimers()
    const adapter = fakeAdapter({ permissions: async () => denied })
    const alerts = make(adapter)
    await alerts.reconcile(journal('active', paused), { fresh: true })
    expect(adapter.state.reads).toBe(1)
    hangOnce(adapter, 'listScheduled')
    let answer
    alerts.reconcile(journal('active'), { restStarted: true }).then(r => { answer = r })
    await vi.advanceTimersByTimeAsync(0)
    expect(answer).toEqual({ step: 'off', asked: false })
    expect(adapter.state.reads).toBe(2)
  })

  test('a return to the app reads again, so a change made in Settings answers the next rest start', async () => {
    let current = granted
    const adapter = fakeAdapter({ permissions: async () => current })
    const alerts = make(adapter)
    expect(await alerts.reconcile(journal('active'), { restStarted: true })).toEqual({ step: 'granted', asked: false })
    current = denied
    await alerts.reconcile(journal('active', paused), { fresh: true })
    expect(await alerts.reconcile(journal('active'), { restStarted: true })).toEqual({ step: 'off', asked: false })
  })

  test('no step known yet (or a fresh read not landed): the rest start waits for its run', async () => {
    vi.useFakeTimers()
    let release
    let current = granted
    const adapter = fakeAdapter({ permissions: () => new Promise(resolve => { release = () => resolve(current) }) })
    const alerts = make(adapter)
    let answer
    alerts.reconcile(journal('active'), { restStarted: true }).then(r => { answer = r })
    await vi.advanceTimersByTimeAsync(0)
    expect(answer).toBeUndefined()
    release()
    await vi.advanceTimersByTimeAsync(0)
    expect(answer).toEqual({ step: 'granted', asked: false })
    // Back from Settings: the step read before is forgotten until the fresh read lands.
    current = denied
    alerts.reconcile(journal('active', paused), { fresh: true })
    let next
    alerts.reconcile(journal('active'), { restStarted: true }).then(r => { next = r })
    await vi.advanceTimersByTimeAsync(0)
    expect(next).toBeUndefined()
    release()
    await vi.advanceTimersByTimeAsync(0)
    release()
    await vi.advanceTimersByTimeAsync(0)
    expect(next).toEqual({ step: 'off', asked: false })
  })
})
