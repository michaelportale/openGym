// The one piece that talks to the server on the phone's behalf: pairs, pulls, pushes and reacts
// to what comes back. One thing runs at a time. It never overwrites the server: a push is always
// the last document the phone pulled plus the phone's own unsent workouts, made against that
// document's rev and wid, and anything unexpected stops it with every workout kept on the phone.
//
// Everything is injected: `client` (api-client.js), `credentials` (the Keychain token),
// `copy` and `meta` (server-copy.js), `workouts` (the finished-workout store) and `now`
// (ms since epoch). It never touches the session journal and logs nothing.

import { buildPush } from './outbox.js'
import { normalizeServer } from './server-address.js'
import { hostOf } from './sync-status.js'

const DAY = 24 * 3600_000

const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v)

// Whether `state` is the document the copy was, or a later write on top of it. A server keeps
// each write's id (`_wid`) and its ancestors' (`_wids`); one whose history lacks the copy's id
// went back in time (restored from an older backup), or is another server or profile.
function descends(prev, state) {
  if (!prev?.wid) return true
  return state._wid === prev.wid || (Array.isArray(state._wids) && state._wids.includes(prev.wid))
}

function pairError(result, base) {
  const host = hostOf(base)
  if (result.kind === 'invalid-code') return "That code didn't work. A code works once and lasts 5 minutes; run the pair command on the Mac for a new one."
  if (result.kind === 'offline') return `Couldn't reach ${host}. Check the address, and that this phone can reach that network.`
  return `${host} answered, but not like an openGym server. Check the address.`
}

export function createSync({ client, credentials, copy, workouts, meta, now }) {
  const iso = () => new Date(now()).toISOString()

  // pair, forget, resendAll and a sync never interleave.
  let tail = Promise.resolve()
  function exclusive(fn) {
    const run = tail.then(fn)
    tail = run.then(() => {}, () => {})
    return run
  }

  let shared = null // the running syncNow promise
  let running = false
  let outcome = null // in memory only: 'waiting' (server not reached) or 'error' (local failure)

  async function paired() {
    const auth = await credentials.get()
    const base = await meta.get('server')
    return auth && base ? { base, token: auth.token } : null
  }

  async function readCopy() {
    try {
      return await copy.get()
    } catch {
      return null // a corrupt copy is re-pulled, as if there were none
    }
  }

  // Every pending workout the server already holds is the server's now (this covers a kill
  // between a 200 and markAcked), and so is one it records as deleted: it is not sent back.
  async function reconcile(state) {
    const held = new Set((Array.isArray(state.workouts) ? state.workouts : []).map(w => w?.id))
    const removed = isMap(state.deleted) && isMap(state.deleted.workouts) ? state.deleted.workouts : {}
    const ids = (await workouts.listPending()).map(w => w.id).filter(id => held.has(id) || Number(removed[id]) > 0)
    if (ids.length) await workouts.markAcked(ids, iso())
  }

  async function store(state, rev) {
    const next = { state, rev, wid: typeof state._wid === 'string' ? state._wid : null, pulledAt: iso() }
    await copy.put(next)
    await reconcile(state)
    return next
  }

  // A document from the server (a pull or a 409) becomes the copy, unless it went back in time.
  async function take(prev, state, rev) {
    if (!descends(prev, state)) return null
    return store(state, rev)
  }

  async function synced() {
    await meta.set('lastSyncedAt', iso())
    await meta.set('problem', null)
    outcome = null
  }

  async function stuck(problem) {
    await meta.set('problem', problem)
    outcome = null
  }

  async function failed(result) {
    if (result.kind === 'unauthorized') {
      // The token was revoked ("sign out everywhere") or the server's secret changed. Only the
      // token goes; the copy, the address and every workout stay.
      await meta.set('problem', 'unpaired')
      await credentials.clear()
      outcome = null
      return
    }
    if (result.kind === 'too-large') return stuck('too-large')
    outcome = 'waiting' // offline, or the server answered with an error: try again later
  }

  // At most once a day, /api/me hands back a fresh token when the current one is past half
  // its life. False when the sync should stop here.
  async function renew(ctx) {
    const last = Date.parse((await meta.get('lastRenewedAt')) ?? '')
    const t = now()
    if (Number.isFinite(last) && t >= last && t - last < DAY) return true
    const r = await client.me(ctx.base, ctx.token)
    if (r.ok) {
      if (r.token) {
        await credentials.set({ token: r.token })
        ctx.token = r.token
      }
      await meta.set('lastRenewedAt', iso())
      return true
    }
    if (r.kind === 'unauthorized' || r.kind === 'offline') {
      await failed(r)
      return false
    }
    return true // an odd answer from /api/me alone does not hold up the sync
  }

  async function runSync() {
    const ctx = await paired()
    if (!ctx) {
      outcome = null
      return
    }
    if (!(await renew(ctx))) return

    let held = await readCopy()
    const r = await client.rev(ctx.base, ctx.token)
    if (!r.ok) return failed(r)
    if (!held || r.rev !== held.rev || (r.wid && r.wid !== held.wid)) {
      const p = await client.pull(ctx.base, ctx.token)
      if (!p.ok) return failed(p)
      held = await take(held, p.state, p.rev)
      if (!held) return stuck('server-older')
    }

    for (let tries = 0; ; tries++) {
      const plan = buildPush(held, await workouts.listPending())
      if (!plan) return synced()
      if (tries === 2) return stuck('conflict')
      const res = await client.push(ctx.base, ctx.token, { state: plan.state, baseRev: plan.baseRev, baseWid: plan.baseWid })
      if (res.ok) {
        await workouts.markAcked(plan.added, iso())
        // The server stamps what it stores, so the copy is its document, not the one sent.
        const p = await client.pull(ctx.base, ctx.token)
        if (!p.ok) return failed(p)
        if (!(await take(held, p.state, p.rev))) return stuck('server-older')
        return synced()
      }
      if (res.kind !== 'conflict') return failed(res)
      // Someone else wrote first: their document becomes the copy and the push goes again on top.
      held = await take(held, res.state, res.rev)
      if (!held) return stuck('server-older')
    }
  }

  async function status() {
    const auth = await credentials.get()
    const server = await meta.get('server')
    const profile = await meta.get('profile')
    const lastSyncedAt = await meta.get('lastSyncedAt')
    let problem = await meta.get('problem')
    const pending = (await workouts.listPending()).length
    const isPaired = !!auth && !!server
    let state
    if (!isPaired) state = 'unpaired'
    else if (running) state = 'syncing'
    else if (problem) state = 'problem'
    else if (outcome === 'error') { state = 'problem'; problem = 'error' }
    else if (outcome === 'waiting') state = 'waiting'
    else state = 'idle'
    return {
      paired: isPaired,
      state,
      ...(problem ? { problem } : {}),
      ...(lastSyncedAt ? { lastSyncedAt } : {}),
      pending,
      ...(server ? { server } : {}),
      ...(profile ? { profile } : {}),
    }
  }

  async function safeStatus() {
    try {
      return await status()
    } catch {
      return { paired: false, state: 'problem', problem: 'error', pending: 0 }
    }
  }

  // A call while a sync runs (or waits its turn) gets that sync's promise. It resolves to
  // status() and never rejects. The sync stops being shared the moment its work ends, not after
  // the status read, so pair()'s own sync is never mistaken for one that ran before the pairing.
  function syncNow() {
    if (!shared) {
      shared = exclusive(async () => {
        running = true
        try {
          await runSync()
        } catch {
          outcome = 'error'
        } finally {
          running = false
          shared = null
        }
      }).then(safeStatus)
    }
    return shared
  }

  async function pair(serverInput, code) {
    const address = normalizeServer(serverInput)
    if (!address.ok) return { ok: false, error: address.error }
    const typed = typeof code === 'string' ? code.trim() : ''
    if (!typed) return { ok: false, error: 'Enter the pairing code from the Mac.' }
    const r = await client.redeem(address.base, typed)
    if (!r.ok) return { ok: false, error: pairError(r, address.base) }
    try {
      await exclusive(async () => {
        // The old token goes first and the new one is written last, so a kill part-way leaves
        // the phone unpaired, never holding one server's token beside another's address.
        await credentials.clear()
        await copy.clear()
        await meta.clear()
        // Every workout on this phone goes to this server; it keeps one copy per id.
        await workouts.resetAcked()
        await meta.set('server', address.base)
        await meta.set('profile', typeof r.user?.name === 'string' ? r.user.name : '')
        await credentials.set({ token: r.token })
        outcome = null
      })
    } catch {
      return { ok: false, error: "Couldn't save the pairing on this phone. Make a new code and try again." }
    }
    await syncNow()
    return { ok: true }
  }

  // Unpair. Every workout stays, and all of them are to be sent to whichever server comes next.
  async function forget() {
    try {
      await exclusive(async () => {
        await credentials.clear()
        await copy.clear()
        await meta.clear()
        await workouts.resetAcked()
        outcome = null
      })
    } catch {
      outcome = 'error'
    }
    return safeStatus()
  }

  // After 'server-older': take the server's document as it is now, and send it every workout of
  // this phone's that it lacks. Acks are cleared before the copy moves, so a kill in between
  // leaves the problem in place rather than workouts marked sent that the server lost.
  async function resendAll() {
    let taken = false
    try {
      await exclusive(async () => {
        const ctx = await paired()
        if (!ctx) return
        running = true
        try {
          const p = await client.pull(ctx.base, ctx.token)
          if (!p.ok) return failed(p)
          await workouts.resetAcked()
          await store(p.state, p.rev)
          await meta.set('problem', null)
          outcome = null
          taken = true
        } finally {
          running = false
        }
      })
    } catch {
      outcome = 'error'
    }
    return taken ? syncNow() : safeStatus()
  }

  return { pair, syncNow, forget, resendAll, status }
}
