/* The WHOOP client (Phase 8): OAuth exchange, token refresh, paged reads and revoke, per user.
 *
 * WHOOP rotates refresh tokens: every refresh returns a new pair and kills the old one, so two
 * refreshes racing on one refresh token leave the loser with a 400, and a rotated pair that is
 * used but never written down is lost on the next restart. Either way the owner has to connect
 * again. Hence the two rules everything below is built around:
 *
 *  - One token operation at a time per uid. Refresh, exchange and revoke run through a per-uid
 *    queue, and each reads the vault inside it, so the second of two callers sees the pair the
 *    first one saved instead of spending the dead refresh token. Callers that just want a usable
 *    access token share the one in flight. A caller whose access token was just rejected (401)
 *    names it, and only refreshes if the vault still holds that token.
 *  - Persist before use. A rotated pair goes to the vault (a synchronous, atomic 0600 write)
 *    before its access token is handed to anyone. If the save throws, the refresh fails and the
 *    vault keeps the old pair; WHOOP has rotated by then, so that ends in a reconnect, never in a
 *    token that only lived in memory.
 *
 * Errors are WhoopError with a fixed message per code. No message ever carries a response body,
 * a token, the client secret or a URL with its query. The server is one process, as it already
 * is; two processes sharing DATA_DIR would race the rotation. Ported from the owner's dashboard
 * (whoop-dashboard/src/whoop.js), which runs this flow against the real API. */

export const WHOOP_BASE = 'https://api.prod.whoop.com';
export const SCOPES = ['read:recovery', 'read:cycles', 'read:sleep', 'read:workout', 'offline'];
const REFRESH_EARLY_MS = 60_000;
const TIMEOUT_MS = 20_000;
const PAGE_LIMIT = '25';
const MAX_PAGES = 20;

const MESSAGES = {
  reconnect: 'Reconnect WHOOP to renew access.',
  rate_limited: 'WHOOP rate limit reached. Try again in a minute.',
  unavailable: 'WHOOP data is unavailable right now. Try again later.',
  unreachable: 'WHOOP could not be reached.',
  incomplete: 'WHOOP returned an incomplete token response. Connect again and allow every permission.',
};

export class WhoopError extends Error {
  constructor(code) {
    super(MESSAGES[code]);
    this.name = 'WhoopError';
    this.code = code;
  }
}

export function createWhoopClient({ base = WHOOP_BASE, clientId, clientSecret, redirectUri, vault, now = Date.now, fetch = globalThis.fetch }) {
  const root = String(base).replace(/\/+$/, '');
  const tokenUrl = `${root}/oauth/oauth2/token`;
  const api = `${root}/developer/v2`;
  const tails = new Map();      // uid -> the end of that uid's queue of token operations
  const inflight = new Map();   // uid -> the access-token lookup already queued, for sharing

  function exclusive(uid, work) {
    const run = (tails.get(uid) ?? Promise.resolve()).then(work);
    const tail = run.then(() => {}, () => {});
    tails.set(uid, tail);
    tail.then(() => { if (tails.get(uid) === tail) tails.delete(uid); });
    return run;
  }

  async function send(url, init) {
    try { return await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS) }); }
    catch { throw new WhoopError('unreachable'); }
  }
  const discard = r => { r.body?.cancel().catch(() => {}); };

  function complete(t) {
    return typeof t?.access_token === 'string' && t.access_token !== ''
      && typeof t.refresh_token === 'string' && t.refresh_token !== ''
      && Number.isFinite(t.expires_in) && t.expires_in > 0
      && typeof t.token_type === 'string' && t.token_type.toLowerCase() === 'bearer'
      && typeof t.scope === 'string' && SCOPES.every(s => t.scope.split(' ').includes(s));
  }

  /** A token grant; the validated pair is saved before its access token is returned. Callers
   * hold the uid's queue. */
  async function grant(uid, params) {
    const r = await send(tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...params }),
    });
    if (!r.ok) {
      discard(r);
      if (r.status === 400 || r.status === 401) {
        // A refused refresh token is dead for good: forget it. A refused code leaves any
        // existing connection alone.
        if (params.grant_type === 'refresh_token') vault.remove(uid);
        throw new WhoopError('reconnect');
      }
      throw new WhoopError(r.status === 429 ? 'rate_limited' : 'unavailable');
    }
    let t;
    try { t = await r.json(); } catch { throw new WhoopError('incomplete'); }
    if (!complete(t)) throw new WhoopError('incomplete');
    const pair = { access_token: t.access_token, refresh_token: t.refresh_token, expires_at: now() + t.expires_in * 1000, scope: t.scope };
    vault.save(uid, pair);
    return pair.access_token;
  }

  /** The vault's access token, refreshed first when it is due or is the one just rejected.
   * Callers hold the uid's queue. */
  async function tokenFor(uid, rejected) {
    const t = vault.read(uid);
    if (!t) throw new WhoopError('reconnect');
    if (t.access_token !== rejected && t.expires_at > now() + REFRESH_EARLY_MS) return t.access_token;
    return grant(uid, { grant_type: 'refresh_token', refresh_token: t.refresh_token, scope: 'offline' });
  }

  function access(uid, rejected) {
    if (rejected === undefined && inflight.has(uid)) return inflight.get(uid);
    const p = exclusive(uid, () => tokenFor(uid, rejected));
    inflight.set(uid, p);
    const clear = () => { if (inflight.get(uid) === p) inflight.delete(uid); };
    p.then(clear, clear);
    return p;
  }

  async function read(uid, url) {
    const call = token => send(url, { headers: { authorization: `Bearer ${token}` } });
    let token = await access(uid);
    let r = await call(token);
    if (r.status === 401) {
      discard(r);
      r = await call(await access(uid, token));
    }
    if (!r.ok) {
      discard(r);
      throw new WhoopError(r.status === 401 ? 'reconnect' : r.status === 429 ? 'rate_limited' : 'unavailable');
    }
    try { return await r.json(); } catch { throw new WhoopError('unavailable'); }
  }

  return {
    authorizeUrl(state) {
      const u = new URL(`${root}/oauth/oauth2/auth`);
      u.search = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: SCOPES.join(' '), state }).toString();
      return u.href;
    },

    /** Swaps an authorization code for a pair and saves it. Resolves to nothing. */
    async exchange(uid, code) {
      await exclusive(uid, () => grant(uid, { grant_type: 'authorization_code', code, redirect_uri: redirectUri }));
    },

    /** Every record of a v2 collection ('cycle', 'recovery', 'activity/sleep',
     * 'activity/workout') from `start` (ISO date-time) on, following next_token. */
    async get(uid, path, { start } = {}) {
      const records = [];
      const seen = new Set();
      let next;
      for (let page = 0; page < MAX_PAGES; page++) {
        const q = new URLSearchParams({ limit: PAGE_LIMIT });
        if (start) q.set('start', start);
        if (next) q.set('nextToken', next);
        const body = await read(uid, `${api}/${path}?${q}`);
        if (!Array.isArray(body?.records)) throw new WhoopError('unavailable');
        records.push(...body.records);
        next = body.next_token;
        if (next == null || next === '') return records;
        if (typeof next !== 'string' || seen.has(next)) throw new WhoopError('unavailable');
        seen.add(next);
      }
      throw new WhoopError('unavailable');
    },

    /** Asks WHOOP to drop this app's access, then deletes the tokens whatever WHOOP said.
     * Resolves true when WHOOP confirmed, false when it could not (or nothing was connected). */
    revoke(uid) {
      return exclusive(uid, async () => {
        if (!vault.read(uid)) return false;
        try {
          const call = token => send(`${api}/user/access`, { method: 'DELETE', headers: { authorization: `Bearer ${token}` } });
          let token = await tokenFor(uid);
          let r = await call(token);
          if (r.status === 401) {
            discard(r);
            r = await call(await tokenFor(uid, token));
          }
          discard(r);
          return r.ok;
        } catch (e) {
          if (e instanceof WhoopError) return false;
          throw e;
        } finally {
          vault.remove(uid);
        }
      });
    },

    connected(uid) {
      return vault.read(uid) !== null;
    },
  };
}
