// When the WHOOP card asks the server, and what it shows when it can't. Only while paired, and per
// pairing: a good read is held until the server's copy (its fetchedAt) is 10 minutes old, when the
// server's own cache lapses, but at least a minute and at most 10 minutes from the read; a
// failure, WHOOP unavailable or a stale read waits a minute; not connected or not set up is never
// held (the server asks WHOOP nothing for it). At once after a Disconnect. After Connect every
// read asks until one comes back connected, for as long as the link lasts (10 minutes): a read
// made while Safari opens must not use up the one that matters, back from Safari. A good read is
// kept in the cache; offline, on a server error or while
// WHOOP is unavailable, the cached read for this pairing is shown instead, marked `cached` with
// its `savedAt`. A read that says not connected or not set up clears the cache. A pairing is its
// server and profile id (names need not be unique). A read that a Disconnect, a Forget or a new
// pairing overtook is thrown away, and a row it saved is taken out again. Nothing here logs.
// Everything is injected: `client` (sync/api-client.js), `cache` (whoop-cache.js), `pairing`
// (resolves { base, token, profileId } or null) and `now`. Every method resolves; none throws.

export const WHOOP_EVERY_MS = 10 * 60 * 1000
export const WHOOP_RETRY_MS = 60 * 1000

// When the read that `r` answered at `t` lets the next one ask again (see the top).
function nextAsk(t, r) {
  if (!r?.ok) return t + WHOOP_RETRY_MS
  const w = r.whoop
  if (!w.configured || !w.connected) return t
  if (w.error || w.stale) return t + WHOOP_RETRY_MS
  const fetched = typeof w.fetchedAt === 'string' ? Date.parse(w.fetchedAt) : NaN
  if (Number.isNaN(fetched)) return t + WHOOP_EVERY_MS
  return Math.min(Math.max(fetched + WHOOP_EVERY_MS, t + WHOOP_RETRY_MS), t + WHOOP_EVERY_MS)
}

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

/** The `pairing` for createWhoopSource, read as the sync engine counts a pairing: a token in the
 * Keychain (`credentials`) and a server address in `meta`. The profile id (stored at pairing)
 * tells same-named profiles apart. These reads are outside the engine's exclusive block, so the
 * address and id are read before and after the token: a pair() or forget() that moved them in
 * between could leave one pairing's token beside another's address. Such a read is made once
 * more, and if the pairing is still moving it counts as unpaired for now (the engine emits when
 * it settles, and the card reads again). */
export function pairingFrom({ credentials, meta }) {
  const where = async () => [await meta.get('server'), (await meta.get('profileId')) ?? '']
  return async () => {
    for (let tries = 0; tries < 2; tries++) {
      const [base, profileId] = await where()
      const auth = await credentials.get()
      const [baseAfter, profileIdAfter] = await where()
      if (base !== baseAfter || profileId !== profileIdAfter) continue
      return auth && base ? { base, token: auth.token, profileId } : null
    }
    return null
  }
}

/** A fresh answer from the server (not the phone's cache, not a failure): it clears a failure line. */
export function isGoodRead(shown) {
  const p = shown?.payload
  return !!shown && shown.paired === true && !shown.cached && !!p && typeof p === 'object' && !p.error
}

// What the card is showing, as far as a failure line said on it goes: a fresh connected read is
// another state than a stale, failed or cached one.
function cardState(shown) {
  const p = shown?.payload
  if (!shown) return 'none'
  if (!shown.paired) return 'unpaired'
  if (!p || typeof p !== 'object') return 'unreachable'
  if (shown.cached) return 'cached'
  if (!p.configured) return 'unconfigured'
  if (!p.connected) return 'disconnected'
  if (p.error) return 'error'
  return p.stale ? 'stale' : 'connected'
}

/**
 * The card's failure line (a Connect or Disconnect that failed) across what happens next. `line`
 * is null or { text, key, state }: what was said, and the pairing (pairingShown) and card it was
 * said on. `{ said, shown, key }` makes a new line; `{ tapped: true }` (Connect or Disconnect
 * again) clears it for the new attempt; `{ read, key }` keeps it unless the pairing changed or a
 * fresh answer from the server (isGoodRead) puts the card in another state: not connected to
 * connected, or stale, failed or cached to a good read. The same state again keeps it, so a
 * re-read on a focus, a sync or a Health emit cannot wipe it before it is read.
 */
export function failureLine(line, event) {
  if (typeof event.said === 'string') return { text: event.said, key: event.key ?? null, state: cardState(event.shown) }
  if (event.tapped || !line) return null
  if ((event.key ?? null) !== line.key) return null
  return isGoodRead(event.read) && cardState(event.read) !== line.state ? null : line
}

export function createWhoopSource({ client, cache, pairing, now }) {
  let last = null // { key, at, until, shown }: the last attempt, for which pairing, when the next may ask, what it showed
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
    // A clock set back since (t < at) asks: it must not hold the card for the difference.
    if (!due && t >= connecting && mine && t >= mine.at && t < mine.until) {
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
    last = { key, at: t, until: nextAsk(t, r), shown }
    shownKey = key
    return shown
  }

  // { ok: true, url } to open in the browser, or { ok: false }: with `unconfigured` when the server
  // has no WHOOP app, and with `elsewhere` (the link's host, with its scheme when only the scheme
  // differs) when the link is on another origin than the paired address, which is then refused:
  // the phone is paired at an address that is not the server's ORIGIN.
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
      if (!origin) return { ok: false }
      const host = o => o.replace(/^https?:\/\//, '')
      const pairedAt = originOf(p.base)
      return { ok: false, elsewhere: pairedAt && host(pairedAt) === host(origin) ? origin : host(origin) }
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

  // The pairing of the read last returned (an opaque key), or null while unpaired: what a failure
  // line is stamped with.
  const pairingShown = () => shownKey ?? null

  return { read, connectLink, disconnect, pairingShown }
}
