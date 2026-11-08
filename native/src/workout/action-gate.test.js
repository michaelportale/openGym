import { expect, test } from 'vitest'
import { createActionGate } from './action-gate.js'

test('a second run while one is pending is ignored', async () => {
  const run = createActionGate()
  let calls = 0
  let release
  const first = run(() => new Promise(resolve => { calls += 1; release = () => resolve('done') }))
  const second = run(async () => { calls += 1; return 'again' })
  expect(await second).toEqual({ ignored: true })
  release()
  expect(await first).toBe('done')
  expect(calls).toBe(1)
})
test('after it settles, the next run goes through', async () => {
  const run = createActionGate()
  expect(await run(async () => 1)).toBe(1)
  expect(await run(async () => 2)).toBe(2)
})
test('a failure releases the gate', async () => {
  const run = createActionGate()
  await expect(run(async () => { throw new Error('boom') })).rejects.toThrow('boom')
  expect(await run(async () => 3)).toBe(3)
})
