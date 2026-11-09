import { expect, test } from 'vitest'
import { createWriteChain } from './write-chain.js'

// A save that resolves only when the test says so, recording what it was given and when.
function manualSave() {
  const calls = []
  const save = next => new Promise(resolve => calls.push({ next, resolve }))
  return { calls, save }
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0))

const stored = (routine, base) => ({ routine, base })

test('rapid writes go one after another, in order, each shown at once', async () => {
  const { calls, save } = manualSave()
  const shown = []
  const chain = createWriteChain(save, a => shown.push(a && a.routine))
  const done = [chain.commit(stored('r1', 'b')), chain.commit(stored('r2', 'b')), chain.commit(stored('r3', 'b'))]
  expect(shown).toEqual(['r1', 'r2', 'r3'])
  expect(chain.ahead().routine).toBe('r3')
  await tick()
  expect(calls.map(c => c.next.routine)).toEqual(['r1']) // the second waits for the first
  calls[0].resolve({ ok: true })
  await tick()
  expect(calls.map(c => c.next.routine)).toEqual(['r1', 'r2'])
  calls[1].resolve({ ok: true })
  await tick()
  calls[2].resolve({ ok: true })
  expect(await Promise.all(done)).toEqual([{ ok: true }, { ok: true }, { ok: true }])
})

test('the base is taken when a chain starts and kept when a newer one arrives mid-chain', async () => {
  const { calls, save } = manualSave()
  const chain = createWriteChain(save)
  // No chain: the store's routine and base.
  const first = chain.from(stored('r0', 'T1'))
  expect(first).toEqual({ routine: 'r0', base: 'T1' })
  chain.commit({ routine: 'r1', base: first.base })
  // A sync stores the web's version (base T2) while the chain runs: the next edit still builds on
  // the chain's routine and the base that routine was made on, never the pre-W routine on T2.
  expect(chain.from(stored('W', 'T2'))).toEqual({ routine: 'r1', base: 'T1' })
  chain.commit({ routine: 'r2', base: chain.from(stored('W', 'T2')).base })
  await tick()
  calls[0].resolve({ ok: true })
  await tick()
  calls[1].resolve({ ok: true })
  await tick()
  expect(calls.map(c => c.next)).toEqual([{ routine: 'r1', base: 'T1' }, { routine: 'r2', base: 'T1' }])
  // Drained: the next chain starts from the store again.
  expect(chain.from(stored('W', 'T2'))).toEqual({ routine: 'W', base: 'T2' })
})

test('ahead clears only when the queue drains', async () => {
  const { calls, save } = manualSave()
  const seen = []
  const chain = createWriteChain(save, a => seen.push(a))
  chain.commit(stored('r1', 'b'))
  const last = chain.commit(stored('r2', 'b'))
  await tick()
  calls[0].resolve({ ok: true })
  await tick()
  expect(chain.ahead()).toEqual({ routine: 'r2', base: 'b' })
  expect(seen.at(-1)).not.toBeNull()
  calls[1].resolve({ ok: true })
  await last
  expect(chain.ahead()).toBeNull()
  expect(seen.at(-1)).toBeNull()
})

test('a failed write mid-chain resolves not ok, the later writes still go, and ahead clears', async () => {
  const saved = []
  const chain = createWriteChain(async next => {
    if (next.routine === 'r2') throw new Error('disk full')
    if (next.routine === 'r3') return { ok: false }
    saved.push(next.routine)
    return { ok: true }
  })
  const results = await Promise.all(['r1', 'r2', 'r3', 'r4'].map(r => chain.commit(stored(r, 'b'))))
  expect(results).toEqual([{ ok: true }, { ok: false }, { ok: false }, { ok: true }])
  expect(saved).toEqual(['r1', 'r4'])
  expect(chain.ahead()).toBeNull()
})
