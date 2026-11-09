import { expect, test } from 'vitest'
import { coalesced } from './coalesce.js'

// A run that finishes when the test says so.
function gated() {
  const runs = []
  const fn = () => new Promise((resolve, reject) => { runs.push({ resolve, reject }) })
  return { runs, fn }
}
const tick = () => new Promise(r => setTimeout(r, 0))

test('one call runs once and resolves with its result', async () => {
  const { runs, fn } = gated()
  const call = coalesced(fn)
  const p = call()
  expect(runs).toHaveLength(1)
  runs[0].resolve('a')
  expect(await p).toBe('a')
})

test('calls while one runs queue exactly one more, started only after it ends', async () => {
  const { runs, fn } = gated()
  const call = coalesced(fn)
  const first = call()
  const second = call()
  const third = call()
  expect(third).toBe(second)
  await tick()
  expect(runs).toHaveLength(1) // the queued one waits
  runs[0].resolve('a')
  expect(await first).toBe('a')
  await tick()
  expect(runs).toHaveLength(2)
  expect(call()).not.toBe(second) // a call while the queued one runs queues one more
  runs[1].resolve('b')
  expect(await second).toBe('b')
  await tick()
  expect(runs).toHaveLength(3)
  runs[2].resolve('c')
  await tick()
  expect(runs).toHaveLength(3)
})

test('after everything settles a call starts a new run; a failure reaches its callers and blocks nothing', async () => {
  const { runs, fn } = gated()
  const call = coalesced(fn)
  const failing = call()
  const queued = call()
  runs[0].reject(new Error('boom'))
  await expect(failing).rejects.toThrow('boom')
  await tick()
  runs[1].resolve('ok')
  expect(await queued).toBe('ok')
  const later = call()
  expect(runs).toHaveLength(3)
  runs[2].resolve('again')
  expect(await later).toBe('again')
})

test('a function that throws at once rejects instead of throwing', async () => {
  const call = coalesced(() => { throw new Error('sync') })
  await expect(call()).rejects.toThrow('sync')
  await expect(call()).rejects.toThrow('sync')
})
