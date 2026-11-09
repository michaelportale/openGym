// The app's only talker to the openGym server. Every call resolves, never throws, and every
// failure is one of a few kinds the sync layer can act on. The token goes out in one place, the
// Authorization header; it is never in a URL, a log line or a returned error.

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
      return shaped(r, j => (j.state && typeof j.state === 'object' && typeof j.rev === 'number' ? { ok: true, state: j.state, rev: j.rev } : null))
    },
    async push(base, token, { state, baseRev, baseWid }) {
      const r = await call(base, '/api/data', { method: 'PUT', token, body: { state, baseRev, baseWid, stamped: false } },
        (status, j) => {
          if (status === 409) return j && j.state && typeof j.rev === 'number' ? { ok: false, kind: 'conflict', rev: j.rev, state: j.state } : server(409)
          if (status === 413) return { ok: false, kind: 'too-large' }
          return null
        })
      return shaped(r, j => ({ ok: true, ts: j.ts, rev: j.rev, wid: j.wid }))
    },
  }
}
