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

// How many ancestors' write ids a server document keeps in `_wids`: WID_KEEP in api/server.js
// (L168). Once the list is this long the oldest ids drop off, so a copy's id missing from a full
// list only means the server has been written that many times since; it says nothing about age.
export const SERVER_WID_KEEP = 50

const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v)

// Whether a document from the server (a pull or a 409) is older than the copy: restored from an
// older backup, or another server or profile. Its revision went back; or the copy's write id is
// in neither its `_wid` nor a `_wids` list short enough to still hold every ancestor.
function wentBack(prev, state, rev) {
  if (!prev) return false
  if (typeof prev.rev === 'number' && rev < prev.rev) return true
  if (!prev.wid || state._wid === prev.wid) return false
  const ancestors = Array.isArray(state._wids) ? state._wids : []
  return !ancestors.includes(prev.wid) && ancestors.length < SERVER_WID_KEEP
}

// The names of the workouts a server document says are gone: deleted (sync-stamps.js DEL_LISTS:
// key -> stamp, positive while deleted) or wiped by "Reset everything" (sync-merge.js resetIdsOf:
// resetIds.workouts is a list of keys).
function goneFrom(state) {
  const removed = isMap(state.deleted) && isMap(state.deleted.workouts) ? state.deleted.workouts : {}
  const wiped = new Set(isMap(state.resetIds) && Array.isArray(state.resetIds.workouts) ? state.resetIds.workouts.map(String) : [])
  return id => Number(removed[id]) > 0 || wiped.has(String(id))
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

  let waiting = null // a sync queued but not yet started: later callers join it
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

  // The only place a workout is acked: once a stored copy of the server's document holds it, the
  // workout is the server's (so the Workout tab still shows it from the copy). One the server
  // records as deleted or wiped by a reset is the server's too, and is not sent back.
  async function reconcile(state) {
    const held = new Set((Array.isArray(state.workouts) ? state.workouts : []).map(w => w?.id))
    const gone = goneFrom(state)
    const ids = (await workouts.listPending()).map(w => w.id).filter(id => held.has(id) || gone(id))
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
    if (wentBack(prev, state, rev)) return null
    return store(state, rev)
  }

  async function synced() {
    await meta.set('lastSyncedAt', iso())
    await meta.set('problem', null)
    await meta.set('httpStatus', null)
    outcome = null
  }

  async function stuck(problem, httpStatus = null) {
    await meta.set('problem', problem)
    await meta.set('httpStatus', httpStatus == null ? null : String(httpStatus))
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
    // A 4xx (other than the ones above) says the same thing every time: say so, keep everything.
    if (result.kind === 'refused') return stuck('refused', result.status)
    outcome = 'waiting' // offline, or a 5xx: try again later
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
    // The same document only when the rev and the write id both match; no wid on one side and a
    // wid on the other is a different document.
    if (!held || r.rev !== held.rev || (r.wid ?? null) !== (held.wid ?? null)) {
      const p = await client.pull(ctx.base, ctx.token)
      if (!p.ok) return failed(p)
      held = await take(held, p.state, p.rev)
      if (!held) return stuck('server-older')
    } else {
      // The copy may have been stored by a sync killed before it reconciled.
      await reconcile(held.state)
    }

    for (let tries = 0; ; tries++) {
      const plan = buildPush(held, await workouts.listPending())
      if (!plan) return synced()
      if (tries === 2) return stuck('conflict')
      const res = await client.push(ctx.base, ctx.token, { state: plan.state, baseRev: plan.baseRev, baseWid: plan.baseWid })
      if (res.ok) {
        // Not acked yet: until a stored copy holds them, the pending rows are what shows them.
        // The pull stores the server's document (it stamps what it stores) and reconcile acks
        // them; if it fails, the next sync sees the moved rev, pulls, and acks without resending.
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
    const httpStatus = Number(await meta.get('httpStatus')) || null
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
      ...(problem && httpStatus ? { httpStatus } : {}),
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

  // A call while a sync waits its turn joins it. A call while one runs schedules one more run
  // after it (any number of such calls, one run), since what it lists as pending may already be
  // out of date: a workout finished meanwhile is sent without another trigger. Resolves to
  // status() and never rejects.
  function syncNow() {
    if (!waiting) {
      waiting = exclusive(async () => {
        waiting = null // started: from here on a call schedules the next run
        running = true
        try {
          await runSync()
        } catch {
          outcome = 'error'
        } finally {
          running = false
        }
      }).then(safeStatus)
    }
    return waiting
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
