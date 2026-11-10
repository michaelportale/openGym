// The app's only talker to the openGym server. Every call resolves, never throws, and every
// failure is one of a few kinds the sync layer can act on. The token goes out in one place, the
// Authorization header; it is never in a URL, a log line or a returned error.

const isDoc = v => !!v && typeof v === 'object' && !Array.isArray(v)
// A profile with no document yet is sent as `state: null`: an empty document at rev 0, so the
// first push can start it.
const docOf = v => (v === null ? {} : isDoc(v) ? v : undefined)
// Request Timeout and Too Many Requests pass by themselves; any other 4xx is the server (or a
// proxy in front of it) refusing, and saying the same thing every time it is asked again.
const PASSING = new Set([408, 429])

export function createApiClient({ fetch, timeoutMs = 15000 }) {
  async function call(base, path, { method = 'GET', token, body } = {}, onStatus) {
    const headers = { Accept: 'application/json' }
    if (token) headers.Authorization = `Bearer ${token}`
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal })
      let json
      try { json = await res.json() } catch { json = undefined }
      // The timeout can fire while the body is still arriving; that is a slow network, not a bad server.
      if (controller.signal.aborted) return { ok: false, kind: 'offline' }
      const status = res.status
      if (status === 401) return { ok: false, kind: 'unauthorized' }
      const special = onStatus?.(status, json)
      if (special) return special
      if (status >= 200 && status < 300 && json !== undefined && json !== null) return { ok: true, json }
      if (status >= 400 && status < 500 && !PASSING.has(status)) return { ok: false, kind: 'refused', status }
      return { ok: false, kind: 'server', status }
    } catch {
      return { ok: false, kind: 'offline' }
    } finally {
      clearTimeout(timer)
    }
  }

  const server = status => ({ ok: false, kind: 'server', status })
  // Shape-check a success body; anything unexpected is the server's fault, not a crash here.
  const shaped = (r, build) => {
    if (!r.ok) return r
    const out = build(r.json)
    return out || server(200)
  }

  return {
    async redeem(base, code) {
      const r = await call(base, '/api/pair/redeem', { method: 'POST', body: { code } },
        (status, j) => (status === 400 && j?.code === 'pair-invalid' ? { ok: false, kind: 'invalid-code' } : null))
      return shaped(r, j => (typeof j.token === 'string' && j.token && j.user ? { ok: true, token: j.token, user: j.user } : null))
    },
    async me(base, token) {
      const r = await call(base, '/api/me', { token })
      return shaped(r, j => (j.user ? { ok: true, user: j.user, ...(typeof j.token === 'string' && j.token ? { token: j.token } : {}) } : null))
    },
    async rev(base, token) {
      const r = await call(base, '/api/data/rev', { token })
      return shaped(r, j => (typeof j.rev === 'number' ? { ok: true, rev: j.rev, wid: j.wid } : null))
    },
    async pull(base, token) {
      const r = await call(base, '/api/data', { token })
      return shaped(r, j => {
        const state = docOf(j.state)
        return state && typeof j.rev === 'number' ? { ok: true, state, rev: j.rev } : null
      })
    },
    async push(base, token, { state, baseRev, baseWid }) {
      const r = await call(base, '/api/data', { method: 'PUT', token, body: { state, baseRev, baseWid, stamped: false } },
        (status, j) => {
          if (status === 409) {
            const theirs = docOf(j?.state)
            return theirs && typeof j.rev === 'number' ? { ok: false, kind: 'conflict', rev: j.rev, state: theirs } : server(409)
          }
          if (status === 413) return { ok: false, kind: 'too-large' }
          return null
        })
      return shaped(r, j => ({ ok: true, ts: j.ts, rev: j.rev, wid: j.wid }))
    },
    // WHOOP, read-only (api/openapi.yaml, tag whoop). The read is the server's normalised numbers;
    // only its known fields are kept, so nothing else the body might carry is ever stored.
    async getWhoop(base, token) {
      const r = await call(base, '/api/whoop', { token })
      return shaped(r, j => {
        if (typeof j.configured !== 'boolean' || typeof j.connected !== 'boolean' || !Array.isArray(j.days) || !Array.isArray(j.workouts)) return null
        const whoop = { configured: j.configured, connected: j.connected, fetchedAt: typeof j.fetchedAt === 'string' ? j.fetchedAt : null, stale: j.stale === true, days: j.days, workouts: j.workouts }
        if (typeof j.error === 'string' && j.error) whoop.error = j.error
        return { ok: true, whoop }
      })
    },
    // A one-use link to open in the browser; 503 is the server with no WHOOP app set up. No body.
    async whoopConnectLink(base, token) {
      const r = await call(base, '/api/whoop/connect-link', { method: 'POST', token },
        status => (status === 503 ? { ok: false, kind: 'unconfigured' } : null))
      return shaped(r, j => (typeof j.url === 'string' && j.url ? { ok: true, url: j.url } : null))
    },
    // revoked: WHOOP was told; wasConnected: there was something to disconnect. No body.
    async whoopDisconnect(base, token) {
      const r = await call(base, '/api/whoop/disconnect', { method: 'POST', token })
      return shaped(r, j => (j.ok === true ? { ok: true, revoked: j.revoked === true, wasConnected: j.wasConnected === true } : null))
    },
  }
}
