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
  // Drained, and the screen has rendered the store since: the next chain starts from the store.
  chain.seen(stored('W', 'T2'))
  expect(chain.from(stored('W', 'T2'))).toEqual({ routine: 'W', base: 'T2' })
})

// Routines as the store holds them: objects, compared by content (sync/edit-guard.js sameRoutine).
const R = (sets, extra = {}) => ({ id: 'a', name: 'Push', ex: [{ id: 'bench', sets }], ...extra })

test('ahead stays while writes are queued, and after the last one lands until the screen renders a stored routine that holds it', async () => {
  const { calls, save } = manualSave()
  const heard = []
  const chain = createWriteChain(save, a => heard.push(a))
  const before = stored(R(3), 'b')
  chain.seen(before)
  chain.commit(stored(R(4), 'b'))
  const last = chain.commit(stored(R(5), 'b'))
  await tick()
  calls[0].resolve({ ok: true })
  await tick()
  expect(chain.ahead()).toEqual(stored(R(5), 'b'))
  calls[1].resolve({ ok: true })
  await last
  // Settled, but the screen has not rendered the reload yet: a tap now builds on the last write,
  // not on the routine from before the chain (which would put an earlier move back).
  expect(chain.ahead()).toEqual(stored(R(5), 'b'))
  expect(chain.from(before)).toEqual(stored(R(5), 'b'))
  expect(heard.at(-1)).not.toBeNull()
  chain.seen(before) // the same stale render again changes nothing
  expect(chain.ahead()).not.toBeNull()
  chain.seen(stored(R(5, { _ts: 9 }), 'b'))
  expect(chain.ahead()).toBeNull()
  expect(heard.at(-1)).toBeNull()
})

test('a render that already showed the last write when the chain settles clears ahead then', async () => {
  const { calls, save } = manualSave()
  const chain = createWriteChain(save)
  chain.seen(stored(R(3), 'b'))
  const done = chain.commit(stored(R(4), 'b'))
  await tick()
  chain.seen(stored(R(4), 'b')) // the reload rendered before the write's promise settled
  calls[0].resolve({ ok: true })
  await done
  expect(chain.ahead()).toBeNull()
})

test('a newer read of the store that does not hold the write clears ahead: the store moved on (a sync took the web\'s version)', async () => {
  const { calls, save } = manualSave()
  const chain = createWriteChain(save)
  const before = stored(R(3), 'b')
  chain.seen(before)
  const done = chain.commit(stored(R(4), 'b'))
  await tick()
  calls[0].resolve({ ok: true })
  await done
  expect(chain.ahead()).not.toBeNull()
  chain.seen(stored(R(7, { name: 'Web' }), 'T2'))
  expect(chain.ahead()).toBeNull()
})

test('a failed write mid-chain resolves not ok, the later writes still go; a failed last write clears ahead at once', async () => {
  const saved = []
  const chain = createWriteChain(async next => {
    if (next.routine === 'r2') throw new Error('disk full')
    if (next.routine === 'r3' || next.routine === 'r5') return { ok: false }
    saved.push(next.routine)
    return { ok: true }
  })
  const results = await Promise.all(['r1', 'r2', 'r3', 'r4'].map(r => chain.commit(stored(r, 'b'))))
  expect(results).toEqual([{ ok: true }, { ok: false }, { ok: false }, { ok: true }])
  expect(saved).toEqual(['r1', 'r4'])
  expect(chain.ahead()).toEqual(stored('r4', 'b')) // landed: kept until a render shows it
  expect(await chain.commit(stored('r5', 'b'))).toEqual({ ok: false })
  expect(chain.ahead()).toBeNull() // the store never took it: show the store
})
