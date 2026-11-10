// When the WHOOP card asks the server, and what it shows when it can't. Only while paired, at most
// every 10 minutes per pairing (an attempt counts, so a failed one waits too), and at once after a
// Disconnect. After Connect every read asks until one comes back connected, for as long as the
// link lasts (10 minutes): a read made while Safari opens must not use up the one that matters,
// back from Safari. A good read is kept in the cache; offline, on a server error or while
// WHOOP is unavailable, the cached read for this pairing is shown instead, marked `cached`. A read
// that says not connected or not set up clears the cache. Nothing here logs. Everything is
// injected: `client` (sync/api-client.js), `cache` (whoop-cache.js), `pairing` (resolves
// { base, token, profile } or null) and `now`. Every method resolves; none throws.

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

export function createWhoopSource({ client, cache, pairing, now }) {
  let last = null // { key, at, shown }: the last attempt, for which pairing, and what it showed
  let due = false // the next read asks whatever the time
  let connecting = 0 // after Connect, until this time, every read asks until one is connected
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
      ? { base: p.base, token: p.token, profile: typeof p.profile === 'string' ? p.profile : '' }
      : null
  }
  const keyOf = p => JSON.stringify([p.base, p.profile])
  async function cachedFor(p) {
    const row = await quiet(() => cache.get())
    return row && row.server === p.base && row.profile === p.profile ? { paired: true, payload: row.payload, cached: true } : null
  }

  // { paired, payload, cached }: payload is a read (the server's, or the cached one), or null
  // when none could be had. onCached(shown) gets the cached read first, before the first fetch for
  // a pairing, so the card need not wait on the network to show it.
  async function read({ onCached } = {}) {
    const p = await paired()
    if (!p) return UNPAIRED
    const key = keyOf(p)
    const t = now()
    const mine = last && last.key === key ? last : null
    if (!due && t >= connecting && mine && t >= mine.at && t - mine.at < WHOOP_EVERY_MS) return mine.shown
    if (!mine && onCached) {
      const early = await cachedFor(p)
      if (early) onCached(early)
    }
    due = false
    const g = gen
    const r = await client.getWhoop(p.base, p.token)
    if (g !== gen) return read({ onCached })
    let shown
    if (r?.ok) {
      const w = r.whoop
      if (w.connected || !w.configured) connecting = 0
      if (!w.configured || !w.connected) {
        await quiet(() => cache.clear())
        shown = { paired: true, payload: w, cached: false }
      } else if (w.error) {
        shown = (await cachedFor(p)) ?? { paired: true, payload: w, cached: false }
      } else {
        await quiet(() => cache.put({ server: p.base, profile: p.profile, savedAt: t, payload: w }))
        shown = { paired: true, payload: w, cached: false }
      }
    } else {
      shown = (await cachedFor(p)) ?? { paired: true, payload: null, cached: false }
    }
    if (g !== gen) return read({ onCached })
    last = { key, at: t, shown }
    return shown
  }

  // { ok: true, url } to open in the browser, or { ok: false } (with `unconfigured` when the server
  // has no WHOOP app). A link anywhere but the paired server's own origin is refused.
  async function connectLink() {
    const p = await paired()
    if (!p) return { ok: false }
    const r = await client.whoopConnectLink(p.base, p.token)
    if (!r?.ok) {
      if (r?.kind !== 'unconfigured') return { ok: false }
      due = true
      return { ok: false, unconfigured: true }
    }
    if (!isServerLink(r.url, p.base)) return { ok: false }
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
