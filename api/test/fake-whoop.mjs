/* A fake WHOOP for the client tests: a node:http server on port 0 that speaks the token grant,
 * the four v2 collections and the revoke endpoint closely enough to catch a careless client.
 *
 * It rotates like the real one. Every grant mints a fresh pair; a refresh consumes the refresh
 * token it was given and kills that pair's access token, so a refresh token used twice — the
 * race a client that does not serialise its refreshes runs — gets a 400, and an access token
 * from before the rotation gets a 401. A refresh without `scope=offline` gets a 400 too.
 *
 * Switches: `force(route, ...entries)` queues what the next requests on a route ('token',
 * 'data', 'revoke') get instead of the normal answer: a status number (its body carries
 * BODY_SECRET, so a test can see a client never repeats a body), `{ status, body }` (that status
 * with that body; a string is sent as is, '' for none), 302 (a redirect to the same
 * collection), 'hang' (never answers), 'drop' (the socket is destroyed), or a function, which is
 * awaited and then the request is served normally (a gate). `override` replaces fields of the
 * next token response (a string replaces the whole body); `page(path, query)` replaces the
 * default paging over `records`. `count` and `log` are what the tests read back. */
import http from 'node:http';
import crypto from 'node:crypto';

export const BODY_SECRET = 'BODY-SECRET-never-echo-this';
export const ALL_SCOPES = 'read:recovery read:cycles read:sleep read:workout offline';
const COLLECTION = /^\/developer\/v2\/(cycle|recovery|activity\/sleep|activity\/workout)$/;

export async function startFakeWhoop({
  clientId = 'fake-client-id',
  clientSecret = 'fake-client-secret-0123456789',
  redirectUri = 'https://gym.test/api/whoop/callback',
  expiresIn = 3600,
} = {}) {
  let seq = 0;
  const codes = new Set();
  const live = [];                                   // pairs WHOOP still honours
  const minted = [];                                 // every token ever issued, for leak checks
  const forced = { token: [], data: [], revoke: [] };

  const fake = {
    url: '', clientId, clientSecret, redirectUri,
    count: { authorization_code: 0, refresh_token: 0, data: 0, revoke: 0 },
    log: [],                                         // { route, method, url, auth, form }
    records: { cycle: [], recovery: [], 'activity/sleep': [], 'activity/workout': [] },
    page: null,
    override: null,
    force(route, ...entries) { forced[route].push(...entries); },
    issueCode() { const c = `code-${++seq}`; codes.add(c); return c; },
    /** A live pair, as a completed grant would leave it, to seed a vault with. */
    issuePair() { return mint(); },
    isLive(accessToken) { return live.some(p => p.access_token === accessToken); },
    /** Everything a client must never echo: every token, the client secret, the forced body. */
    secrets() { return [clientSecret, BODY_SECRET, ...minted]; },
    close() { server.closeAllConnections(); return new Promise(r => server.close(r)); },
  };

  function mint() {
    const id = ++seq;
    const rand = crypto.randomBytes(9).toString('base64url');
    const pair = { access_token: `fake-at-${id}-${rand}`, refresh_token: `fake-rt-${id}-${rand}`, expires_in: expiresIn, scope: ALL_SCOPES, token_type: 'bearer' };
    live.push({ access_token: pair.access_token, refresh_token: pair.refresh_token });
    minted.push(pair.access_token, pair.refresh_token);
    return pair;
  }
  const drop = p => live.splice(live.indexOf(p), 1);
  const bearer = req => /^Bearer (.+)$/.exec(req.headers.authorization || '')?.[1];

  function send(res, status, body) {
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(text);
  }

  /** True when a forced entry answered (or swallowed) the request. */
  async function forcedAnswer(route, req, res, url) {
    if (!forced[route].length) return false;
    const f = forced[route].shift();
    if (typeof f === 'function') { await f(); return false; }
    if (f === 'hang') return true;
    if (f === 'drop') { req.socket.destroy(); return true; }
    if (f === 302) { res.writeHead(302, { location: `${url.pathname}?redirected=1` }); res.end(); return true; }
    if (typeof f === 'object') { send(res, f.status, f.body); return true; }
    send(res, f, { error: 'forced', detail: BODY_SECRET });
    return true;
  }

  async function token(req, res, url, form) {
    const type = form.get('grant_type');
    if (type === 'authorization_code' || type === 'refresh_token') fake.count[type]++;
    if (await forcedAnswer('token', req, res, url)) return;
    if (form.get('client_id') !== clientId || form.get('client_secret') !== clientSecret) return send(res, 401, { error: 'invalid_client' });
    if (type === 'authorization_code') {
      if (!codes.delete(form.get('code')) || form.get('redirect_uri') !== redirectUri) return send(res, 400, { error: 'invalid_grant' });
    } else if (type === 'refresh_token') {
      const p = live.find(x => x.refresh_token === form.get('refresh_token'));
      if (!p || form.get('scope') !== 'offline') return send(res, 400, { error: 'invalid_grant' });
      drop(p);                                       // rotation: the old refresh and access tokens die
    } else return send(res, 400, { error: 'unsupported_grant_type' });
    const pair = mint();
    const o = fake.override;
    fake.override = null;
    send(res, 200, typeof o === 'string' ? o : { ...pair, ...o });
  }

  async function collection(req, res, url, path) {
    fake.count.data++;
    if (await forcedAnswer('data', req, res, url)) return;
    if (!fake.isLive(bearer(req))) return send(res, 401, { error: 'unauthorized' });
    if (fake.page) return send(res, 200, fake.page(path, url.searchParams));
    const all = fake.records[path];
    const limit = Math.min(Number(url.searchParams.get('limit')) || 10, 25);
    const offset = url.searchParams.has('nextToken') ? Number(url.searchParams.get('nextToken').slice(1)) : 0;
    const end = offset + limit;
    send(res, 200, { records: all.slice(offset, end), next_token: end < all.length ? `o${end}` : null });
  }

  async function revoke(req, res, url) {
    fake.count.revoke++;
    if (await forcedAnswer('revoke', req, res, url)) return;
    const p = live.find(x => x.access_token === bearer(req));
    if (!p) return send(res, 401, { error: 'unauthorized' });
    drop(p);
    res.writeHead(204);
    res.end();
  }

  const server = http.createServer(async (req, res) => {
    try {
      let body = '';
      for await (const chunk of req) body += chunk;
      const url = new URL(req.url, 'http://fake');
      const form = new URLSearchParams(body);
      const key = `${req.method} ${url.pathname}`;
      const isToken = key === 'POST /oauth/oauth2/token';
      fake.log.push({ route: isToken ? 'token' : key, method: req.method, url: req.url, auth: req.headers.authorization, form: isToken ? Object.fromEntries(form) : null });
      const m = COLLECTION.exec(url.pathname);
      if (isToken) return await token(req, res, url, form);
      if (req.method === 'GET' && m) return await collection(req, res, url, m[1]);
      if (key === 'DELETE /developer/v2/user/access') return await revoke(req, res, url);
      send(res, 404, { error: 'not_found' });
    } catch {
      if (!res.headersSent) send(res, 500, { error: 'fake failed' });
    }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  fake.url = `http://127.0.0.1:${server.address().port}`;
  return fake;
}
