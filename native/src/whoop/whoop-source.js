// When the WHOOP card asks the server, and what it shows when it can't. Only while paired, at most
// every 10 minutes per pairing (an attempt counts, so a failed one waits too), and at once after a
// Disconnect. After Connect every read asks until one comes back connected, for as long as the
// link lasts (10 minutes): a read made while Safari opens must not use up the one that matters,
// back from Safari. A good read is kept in the cache; offline, on a server error or while
// WHOOP is unavailable, the cached read for this pairing is shown instead, marked `cached` with
// its `savedAt`. A read that says not connected or not set up clears the cache. A pairing is its
// server and profile id (names need not be unique). A read that a Disconnect, a Forget or a new
// pairing overtook is thrown away, and a row it saved is taken out again. Nothing here logs.
// Everything is injected: `client` (sync/api-client.js), `cache` (whoop-cache.js), `pairing`
// (resolves { base, token, profileId } or null) and `now`. Every method resolves; none throws.

export const WHOOP_EVERY_MS = 10 * 60 * 1000

const UNPAIRED = Object.freeze({ paired: false, payload: null, cached: false })

// A link with a space or a control character anywhere is refused outright.
const UNSAFE = /[\u0000-\u0020\u007f]/

// 'HTTPS://Gym.Example.com:443/x?c=1' -> 'https://gym.example.com'; null for anything else. The
// whole authority is compared, so a user part or a backslash in it never matches a paired base.
function originOf(s) {
  if (typeof s !== 'string' || UNSAFE.test(s)) return null
  const m = /^(https?):\/\/([^/?#]+)/i.exec(s)
  if (!m) return null
  const scheme = m[1].toLowerCase()
  const port = scheme === 'https' ? ':443' : ':80'
  let authority = m[2].toLowerCase()
  if (authority.endsWith(port)) authority = authority.slice(0, -port.length)
  return authority ? `${scheme}://${authority}` : null
}

/** True when `url` is http(s) on the paired server's own origin (`base`), so it may be opened. */
export function isServerLink(url, base) {
  const origin = originOf(url)
  return origin !== null && origin === originOf(base)
}

/** A fresh answer from the server (not the phone's cache, not a failure): it clears a failure line. */
export function isGoodRead(shown) {
  const p = shown?.payload
  return !!shown && shown.paired === true && !shown.cached && !!p && typeof p === 'object' && !p.error
}

export function createWhoopSource({ client, cache, pairing, now }) {
  let last = null // { key, at, shown }: the last attempt, for which pairing, and what it showed
  let due = false // the next read asks whatever the time
  let connecting = 0 // after Connect, until this time, every read asks until one is connected
  let shownKey // the pairing whose read the caller was last given (null: unpaired)
  let gen = 0 // moved by a Disconnect, so a read that was out across one is thrown away

  const quiet = async fn => {
    try {
      return await fn()
    } catch {
      return null
    }
  }
  const paired = async () => {
    const p = await quiet(pairing)
    return p && typeof p.base === 'string' && p.base && typeof p.token === 'string' && p.token
      ? { base: p.base, token: p.token, profileId: typeof p.profileId === 'string' ? p.profileId : '' }
      : null
  }
  const keyOf = p => JSON.stringify([p.base, p.profileId])
  async function cachedFor(p) {
    const row = await quiet(() => cache.get())
    return row && row.server === p.base && row.profileId === p.profileId
      ? { paired: true, payload: row.payload, cached: true, savedAt: row.savedAt }
      : null
  }
  // Since the read began: a Disconnect, or the pairing gone or changed (Forget, a new pairing).
  const overtaken = async (g, key) => {
    if (g !== gen) return true
    const p = await paired()
    return !p || keyOf(p) !== key
  }

  // { paired, payload, cached, savedAt? }: payload is a read (the server's, or the cached one), or
  // null when none could be had. Before a fetch, onCached(shown) gets this pairing's cached read so
  // the card need not wait on the network; when the pairing is not the one last shown it is called
  // even with nothing cached (null), so another pairing's card never stays up meanwhile.
  async function read({ onCached } = {}) {
    const p = await paired()
    if (!p) {
      shownKey = null
      return UNPAIRED
    }
    const key = keyOf(p)
    const t = now()
    const mine = last && last.key === key ? last : null
    if (!due && t >= connecting && mine && t >= mine.at && t - mine.at < WHOOP_EVERY_MS) {
      shownKey = key
      return mine.shown
    }
    if (onCached && (!mine || key !== shownKey)) {
      const early = await cachedFor(p)
      if (early || key !== shownKey) onCached(early)
    }
    due = false
    const g = gen
    const r = await client.getWhoop(p.base, p.token)
    if (await overtaken(g, key)) return read({ onCached })
    let shown
    let wrote = false
    if (r?.ok) {
      const w = r.whoop
      if (w.connected || !w.configured) connecting = 0
      if (!w.configured || !w.connected) {
        await quiet(() => cache.clear())
        shown = { paired: true, payload: w, cached: false }
      } else if (w.error) {
        shown = (await cachedFor(p)) ?? { paired: true, payload: w, cached: false }
      } else {
        await quiet(() => cache.put({ server: p.base, profileId: p.profileId, savedAt: t, payload: w }))
        wrote = true
        shown = { paired: true, payload: w, cached: false }
      }
    } else {
      shown = (await cachedFor(p)) ?? { paired: true, payload: null, cached: false }
    }
    if (await overtaken(g, key)) {
      // Its row may have landed after the Disconnect's or the engine's clear: take it out again.
      if (wrote) await quiet(() => cache.clear())
      return read({ onCached })
    }
    last = { key, at: t, shown }
    shownKey = key
    return shown
  }

  // { ok: true, url } to open in the browser, or { ok: false }: with `unconfigured` when the server
  // has no WHOOP app, and with `elsewhere` (the link's host) when the link is on another origin than
  // the paired address, which is then refused: the phone is paired at an address that is not the
  // server's ORIGIN.
  async function connectLink() {
    const p = await paired()
    if (!p) return { ok: false }
    const r = await client.whoopConnectLink(p.base, p.token)
    if (!r?.ok) {
      if (r?.kind !== 'unconfigured') return { ok: false }
      due = true
      return { ok: false, unconfigured: true }
    }
    if (!isServerLink(r.url, p.base)) {
      const origin = originOf(r.url)
      return origin ? { ok: false, elsewhere: origin.replace(/^https?:\/\//, '') } : { ok: false }
    }
    connecting = now() + WHOOP_EVERY_MS
    return { ok: true, url: r.url }
  }

  // { ok: true, revoked, wasConnected } or { ok: false }. Only a server that answered clears the cache.
  async function disconnect() {
    const p = await paired()
    if (!p) return { ok: false }
    const r = await client.whoopDisconnect(p.base, p.token)
    if (!r?.ok) return { ok: false }
    gen += 1
    last = null // the next read asks at once
    connecting = 0
    await quiet(() => cache.clear())
    return { ok: true, revoked: r.revoked, wasConnected: r.wasConnected }
  }

  return { read, connectLink, disconnect }
}
