/* The WHOOP routes (Phase 8, Task 4): connect-link, connect, callback, read and disconnect,
   against the real server.js in a child and the fake WHOOP in this process.

   What has to hold, because this server keeps the owner's real data and the WHOOP grant opens a
   third-party account:
   - one user never sees, connects or disconnects another's WHOOP;
   - a link code and a state are each good once, for ten minutes, for the uid they were made for;
   - no token and no client secret ever reaches a response, a page, a log line or a file in clear.

   The server's Date.now() is driven by test/fake-clock.mjs, so the ten-minute edges are exact. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { boundPort } from './helpers.mjs';
import { startFakeWhoop } from './fake-whoop.mjs';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = 'http://localhost:8080';
const SECRET = crypto.randomBytes(32).toString('hex');
const A = 'whoopUserA_1', B = 'whoopUserB_1', ADMIN = 'whoopAdmin_1';
const MIN = 60000, DAY = 86400000;
// Noon UTC today: the window and the seeded records never straddle a UTC midnight.
const T0 = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate(), 12);
const iso = ms => new Date(ms).toISOString();
const TODAY = iso(T0).slice(0, 10);

// Same construction as server.js makeSession(): `uid:exp:sv:kind`, HMAC-SHA256 over SECRET.
const token = (uid, kind = 'b') => {
  const payload = `${uid}:${Date.now() + 30 * DAY}:0:${kind}`;
  return payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
};

const SUCCESS = 'WHOOP is connected. You can close this tab and go back to openGym.';
const failed = reason => `WHOOP wasn't connected: ${reason}. Go back to openGym and try again.`;
const EXPIRED = failed('the link expired');
const USED = failed('the link was already used');
const SAID_NO = failed('WHOOP said no');
const UNREACHABLE = failed("WHOOP couldn't be reached");
// The text a person reads on the page: tags dropped, the five escapes undone.
const pageText = html => html.replace(/<style[\s\S]*?<\/style>|<title>[\s\S]*?<\/title>/g, '').replace(/<[^>]*>/g, ' ')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ').trim();

function seed(fake) {
  fake.records.cycle = [{ id: 1, start: iso(T0 - 10 * 3600000), end: null, timezone_offset: '+00:00', score_state: 'SCORED', score: { strain: 12.34 } }];
  fake.records['activity/sleep'] = [{ id: 's1', cycle_id: 1, start: iso(T0 - 10 * 3600000), end: iso(T0 - 2 * 3600000), nap: false, timezone_offset: '+00:00', score_state: 'SCORED', score: {} }];
  fake.records.recovery = [{ cycle_id: 1, sleep_id: 's1', score_state: 'SCORED', score: { recovery_score: 67, hrv_rmssd_milli: 55.5, resting_heart_rate: 52, user_calibrating: false } }];
  fake.records['activity/workout'] = [{ id: 'w1', start: iso(T0 - 5 * 3600000), end: iso(T0 - 4 * 3600000), timezone_offset: '+00:00', sport_name: 'running', score_state: 'SCORED', score: { strain: 8.1, average_heart_rate: 140, kilojoule: 2092 } }];
}

/** A server.js child (WHOOP configured against `fake` unless `fake` is null) with users A, B and
 * an admin, its clock at T0, and every response and log line kept for the leak scan. */
async function boot(t, { fake } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-whoop-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  const created = new Date().toISOString();
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
    users: [{ id: A, name: 'Ann', created }, { id: B, name: 'Bea', created }, { id: ADMIN, name: 'Adm', created, admin: true }],
    creds: [], subs: [], invites: []
  }));
  // A WHOOP_* in the shell running the tests must not configure the "not configured" server.
  const { WHOOP_CLIENT_ID, WHOOP_CLIENT_SECRET, WHOOP_BASE_URL, ...env } = process.env;
  const child = spawn(process.execPath, ['--import', './test/fake-clock.mjs', 'server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: {
      ...env, PORT: '0', DATA_DIR: dataDir, ORIGIN, RP_ID: 'localhost',
      ...(fake ? { WHOOP_CLIENT_ID: fake.clientId, WHOOP_CLIENT_SECRET: fake.clientSecret, WHOOP_BASE_URL: fake.url } : {})
    }
  });
  let log = '';
  child.stdout.on('data', d => log += d);
  child.stderr.on('data', d => log += d);
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const api = `http://127.0.0.1:${await boundPort(child, () => log)}`;
  const seen = [];

  const h = {
    dataDir, seen, log: () => log,
    file: uid => path.join(dataDir, `whoop-${uid}.json`),
    at: now => new Promise(resolve => {
      const done = m => { if (m && m.now === now) { child.off('message', done); resolve(); } };
      child.on('message', done);
      child.send({ now });
    }),
    /** A request as the phone makes it (`as`: a bearer for that uid) or as a browser (`headers`). */
    async req(method, p, { as, headers = {}, body } = {}) {
      const r = await fetch(api + p, {
        method, redirect: 'manual',
        headers: { ...(as ? { Authorization: `Bearer ${token(as)}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
        ...(body ? { body: JSON.stringify(body) } : {})
      });
      const text = await r.text();
      seen.push(`${method} ${p} -> ${r.status} ${JSON.stringify([...r.headers])}\n${text}`);
      return { status: r.status, headers: r.headers, text, json: () => JSON.parse(text) };
    },
    whoop: uid => h.req('GET', '/api/whoop', { as: uid }),
    /** Link, connect and callback for `uid`, as Safari would walk it. */
    async connect(uid) {
      const link = await h.req('POST', '/api/whoop/connect-link', { as: uid });
      assert.equal(link.status, 200, log);
      const c = new URL(link.json().url).searchParams.get('c');
      const go = await h.req('GET', `/api/whoop/connect?c=${encodeURIComponent(c)}`);
      assert.equal(go.status, 302, go.text);
      const state = new URL(go.headers.get('location')).searchParams.get('state');
      const cb = await h.req('GET', `/api/whoop/callback?code=${fake.issueCode()}&state=${encodeURIComponent(state)}`);
      assert.equal(cb.status, 200, cb.text);
      assert.equal(pageText(cb.text), SUCCESS);
      return { c, state };
    },
    /** No WHOOP secret in any response, header, page, log line, or file under DATA_DIR. */
    assertNoLeak() {
      const files = fs.readdirSync(dataDir).filter(f => fs.statSync(path.join(dataDir, f)).isFile())
        .map(f => `${f}\n${fs.readFileSync(path.join(dataDir, f), 'utf8')}`);
      const haystack = [...seen, log, ...files];
      for (const s of fake.secrets()) {
        for (const hay of haystack) assert.ok(!hay.includes(s), `a WHOOP secret leaked into:\n${hay.slice(0, 400)}`);
      }
      assert.ok(seen.length > 0);
    }
  };
  await h.at(T0);
  return h;
}

async function whoopFake(t) {
  const fake = await startFakeWhoop({ redirectUri: `${ORIGIN}/api/whoop/callback` });
  t.after(() => fake.close());
  seed(fake);
  return fake;
}

const NOT_CONNECTED = { configured: true, connected: false, fetchedAt: null, stale: false, days: [], workouts: [] };

test('the full connect flow: link, WHOOP, callback, then GET /api/whoop is filled', async t => {
  const fake = await whoopFake(t);
  const h = await boot(t, { fake });

  assert.deepEqual((await h.whoop(A)).json(), NOT_CONNECTED);

  const link = await h.req('POST', '/api/whoop/connect-link', { as: A });
  assert.equal(link.status, 200);
  const { url } = link.json();
  assert.match(url, /^http:\/\/localhost:8080\/api\/whoop\/connect\?c=[A-Za-z0-9_-]{43}$/, 'a 32-byte base64url code on ORIGIN');

  const go = await h.req('GET', new URL(url).pathname + new URL(url).search);
  assert.equal(go.status, 302);
  assert.equal(go.headers.get('cache-control'), 'no-store');
  const auth = new URL(go.headers.get('location'));
  assert.equal(auth.origin + auth.pathname, `${fake.url}/oauth/oauth2/auth`);
  assert.equal(auth.searchParams.get('client_id'), fake.clientId);
  assert.equal(auth.searchParams.get('redirect_uri'), `${ORIGIN}/api/whoop/callback`);
  assert.equal(auth.searchParams.get('response_type'), 'code');
  assert.equal(auth.searchParams.get('scope'), 'read:recovery read:cycles read:sleep read:workout offline');
  const state = auth.searchParams.get('state');
  assert.match(state, /^[A-Za-z0-9_-]{43}$/, 'a 32-byte base64url state');
  assert.notEqual(state, new URL(url).searchParams.get('c'), 'the state is not the link code');

  const cb = await h.req('GET', `/api/whoop/callback?code=${fake.issueCode()}&state=${state}`);
  assert.equal(cb.status, 200);
  assert.equal(cb.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.equal(cb.headers.get('cache-control'), 'no-store');
  assert.equal(pageText(cb.text), SUCCESS);
  assert.equal(fake.count.authorization_code, 1);
  assert.equal(fs.statSync(h.file(A)).mode & 0o777, 0o600, 'the token file is 0600');

  const r = await h.whoop(A);
  assert.equal(r.status, 200);
  const body = r.json();
  assert.deepEqual(Object.keys(body).sort(), ['configured', 'connected', 'days', 'fetchedAt', 'stale', 'workouts']);
  assert.equal(body.configured, true);
  assert.equal(body.connected, true);
  assert.equal(body.stale, false);
  assert.equal(body.fetchedAt, iso(T0));
  assert.equal(body.days.length, 14);
  assert.equal(body.days[0].d, TODAY, 'newest first, ending today');
  assert.deepEqual(body.days[0], { d: TODAY, recovery: 67, hrv: 55.5, rhr: 52, calibrating: false, strain: 12.34 });
  assert.deepEqual(body.workouts, [{ d: TODAY, sport: 'running', start: iso(T0 - 5 * 3600000), minutes: 60, strain: 8.1, avgHr: 140, kcal: 500 }]);

  // Four collections, 25 a page, from 16 days back.
  const reads = fake.log.filter(e => e.method === 'GET');
  assert.deepEqual(reads.map(e => new URL(e.url, 'http://x').pathname).sort(),
    ['/developer/v2/activity/sleep', '/developer/v2/activity/workout', '/developer/v2/cycle', '/developer/v2/recovery']);
  for (const e of reads) {
    const q = new URL(e.url, 'http://x').searchParams;
    assert.equal(q.get('start'), iso(T0 - 16 * DAY));
    assert.equal(q.get('limit'), '25');
  }
  h.assertNoLeak();
});

test('a link code and a state are each good once, and nothing from the query is echoed', async t => {
  const fake = await whoopFake(t);
  const h = await boot(t, { fake });

  const { c, state } = await h.connect(A);
  const again = await h.req('GET', `/api/whoop/connect?c=${encodeURIComponent(c)}`);
  assert.equal(again.status, 400);
  assert.equal(pageText(again.text), USED, 'a replayed code');
  const replay = await h.req('GET', `/api/whoop/callback?code=${fake.issueCode()}&state=${encodeURIComponent(state)}`);
  assert.equal(replay.status, 400);
  assert.equal(pageText(replay.text), USED, 'a replayed state');
  assert.equal(fake.count.authorization_code, 1, 'a replayed state never reaches WHOOP');

  for (const q of ['', '?c=', '?c=nope', `?c=${crypto.randomBytes(32).toString('base64url')}`]) {
    const r = await h.req('GET', `/api/whoop/connect${q}`);
    assert.equal(r.status, 400, q);
    assert.equal(pageText(r.text), EXPIRED, q);
  }
  for (const q of ['', '?code=x', `?code=x&state=${crypto.randomBytes(32).toString('base64url')}`]) {
    const r = await h.req('GET', `/api/whoop/callback${q}`);
    assert.equal(r.status, 400, q);
    assert.equal(pageText(r.text), EXPIRED, q);
  }

  // A value from the query never reaches the page, escaped or not.
  const marker = '<script>alert("MARK-3f9")</script>';
  for (const p of [`/api/whoop/connect?c=${encodeURIComponent(marker)}`, `/api/whoop/callback?code=${encodeURIComponent(marker)}&state=${encodeURIComponent(marker)}`]) {
    const r = await h.req('GET', p);
    assert.ok(!r.text.includes('MARK-3f9'), r.text);
    assert.ok(!r.text.includes('<script'), r.text);
  }

  // Six codes for one profile: only the newest five are kept, so a loop cannot grow the table.
  const codes = [];
  for (let i = 0; i < 6; i++) codes.push(new URL((await h.req('POST', '/api/whoop/connect-link', { as: B })).json().url).searchParams.get('c'));
  assert.equal(pageText((await h.req('GET', `/api/whoop/connect?c=${codes[0]}`)).text), EXPIRED, 'the oldest was dropped');
  assert.equal((await h.req('GET', `/api/whoop/connect?c=${codes[1]}`)).status, 302, 'the second still works');
  h.assertNoLeak();
});

test('the callback: WHOOP refusing, a denied consent and WHOOP down each give their reason and use the state up', async t => {
  const fake = await whoopFake(t);
  const h = await boot(t, { fake });
  const stateFor = async uid => {
    const c = new URL((await h.req('POST', '/api/whoop/connect-link', { as: uid })).json().url).searchParams.get('c');
    return new URL((await h.req('GET', `/api/whoop/connect?c=${c}`)).headers.get('location')).searchParams.get('state');
  };

  // The person said no at WHOOP: WHOOP comes back with error=access_denied and no code.
  let state = await stateFor(A);
  let r = await h.req('GET', `/api/whoop/callback?error=access_denied&error_description=nope&state=${state}`);
  assert.equal(r.status, 400);
  assert.equal(pageText(r.text), SAID_NO);
  assert.equal(pageText((await h.req('GET', `/api/whoop/callback?code=${fake.issueCode()}&state=${state}`)).text), USED, 'the state went with the refusal');

  // WHOOP refuses the code (invalid_grant).
  state = await stateFor(A);
  r = await h.req('GET', `/api/whoop/callback?code=not-a-real-code&state=${state}`);
  assert.equal(pageText(r.text), SAID_NO);

  // Every permission has to be granted.
  state = await stateFor(A);
  fake.override = { scope: 'read:recovery offline' };
  r = await h.req('GET', `/api/whoop/callback?code=${fake.issueCode()}&state=${state}`);
  assert.equal(pageText(r.text), SAID_NO);

  // WHOOP down at the token endpoint.
  state = await stateFor(A);
  fake.force('token', 503);
  r = await h.req('GET', `/api/whoop/callback?code=${fake.issueCode()}&state=${state}`);
  assert.equal(r.status, 502);
  assert.equal(pageText(r.text), UNREACHABLE);
  state = await stateFor(A);
  fake.force('token', 'drop');
  r = await h.req('GET', `/api/whoop/callback?code=${fake.issueCode()}&state=${state}`);
  assert.equal(pageText(r.text), UNREACHABLE);

  assert.equal(fs.existsSync(h.file(A)), false, 'none of that connected anything');
  assert.deepEqual((await h.whoop(A)).json(), NOT_CONNECTED);
  h.assertNoLeak();
});

test('a link code and a state expire ten minutes after they were made (fake clock)', async t => {
  const fake = await whoopFake(t);
  const h = await boot(t, { fake });
  const link = async () => new URL((await h.req('POST', '/api/whoop/connect-link', { as: A })).json().url).searchParams.get('c');

  const [c1, c2, c3] = [await link(), await link(), await link()];
  await h.at(T0 + 10 * MIN - 1);
  assert.equal((await h.req('GET', `/api/whoop/connect?c=${c1}`)).status, 302, 'good until the last millisecond');
  await h.at(T0 + 10 * MIN);
  const late = await h.req('GET', `/api/whoop/connect?c=${c2}`);
  assert.equal(late.status, 400);
  assert.equal(pageText(late.text), EXPIRED);
  await h.at(T0 + 60 * MIN);
  assert.equal(pageText((await h.req('GET', `/api/whoop/connect?c=${c3}`)).text), EXPIRED);

  // A state minted now is dead ten minutes on, before any exchange.
  const T1 = T0 + 2 * 60 * MIN;
  await h.at(T1);
  const go = await h.req('GET', `/api/whoop/connect?c=${await link()}`);
  const state = new URL(go.headers.get('location')).searchParams.get('state');
  await h.at(T1 + 10 * MIN);
  const cb = await h.req('GET', `/api/whoop/callback?code=${fake.issueCode()}&state=${state}`);
  assert.equal(pageText(cb.text), EXPIRED);
  assert.equal(fake.count.authorization_code, 0, 'an expired state never reaches WHOOP');
  assert.equal(fs.existsSync(h.file(A)), false);
  h.assertNoLeak();
});

test("a state made for A stores A's tokens whoever opens the callback, and B can neither read nor disconnect A", async t => {
  const fake = await whoopFake(t);
  const h = await boot(t, { fake });

  const c = new URL((await h.req('POST', '/api/whoop/connect-link', { as: A })).json().url).searchParams.get('c');
  const state = new URL((await h.req('GET', `/api/whoop/connect?c=${c}`)).headers.get('location')).searchParams.get('state');
  // B's browser, signed in as B both ways, finishes A's flow.
  const cb = await h.req('GET', `/api/whoop/callback?code=${fake.issueCode()}&state=${state}`, {
    headers: { Authorization: `Bearer ${token(B)}`, Cookie: `gymsid=${token(B, 'c')}` }
  });
  assert.equal(pageText(cb.text), SUCCESS);
  assert.equal(fs.existsSync(h.file(A)), true, 'stored for the uid the state was made for');
  assert.equal(fs.existsSync(h.file(B)), false, 'never for the caller');

  assert.deepEqual((await h.whoop(B)).json(), NOT_CONNECTED);
  const a = (await h.whoop(A)).json();
  assert.equal(a.connected, true);

  const off = await h.req('POST', '/api/whoop/disconnect', { as: B });
  assert.equal(off.status, 200);
  assert.deepEqual(off.json(), { ok: true, revoked: false, wasConnected: false });
  assert.equal(fake.count.revoke, 0, "B's disconnect never touched A's grant");
  assert.equal(fs.existsSync(h.file(A)), true);
  assert.equal((await h.whoop(A)).json().connected, true);
  h.assertNoLeak();
});

test('not configured: configured false everywhere, a 503 link, and no session no answer', async t => {
  const h = await boot(t, { fake: null });

  assert.deepEqual((await h.whoop(A)).json(), { ...NOT_CONNECTED, configured: false });
  const link = await h.req('POST', '/api/whoop/connect-link', { as: A });
  assert.equal(link.status, 503);
  assert.ok(link.json().error);
  const go = await h.req('GET', '/api/whoop/connect?c=anything');
  assert.equal(go.status, 400);
  assert.equal(pageText(go.text), EXPIRED);
  assert.equal(pageText((await h.req('GET', '/api/whoop/callback?code=x&state=y')).text), EXPIRED);
  assert.deepEqual((await h.req('POST', '/api/whoop/disconnect', { as: A })).json(), { ok: true, revoked: false, wasConnected: false });

  for (const [m, p] of [['GET', '/api/whoop'], ['POST', '/api/whoop/connect-link'], ['POST', '/api/whoop/disconnect']]) {
    assert.equal((await h.req(m, p)).status, 401, `${m} ${p} without a session`);
  }
});

test('the read is cached ten minutes per profile, and two reads at once share one fetch', async t => {
  const fake = await whoopFake(t);
  const h = await boot(t, { fake });
  await h.connect(A);

  const first = (await h.whoop(A)).json();
  assert.equal(fake.count.data, 4);
  await h.at(T0 + 10 * MIN - 1);
  assert.deepEqual((await h.whoop(A)).json(), first, 'served from the cache');
  assert.equal(fake.count.data, 4, 'no second fetch inside ten minutes');

  await h.at(T0 + 10 * MIN);
  let release;
  const gate = new Promise(r => { release = r; });
  fake.force('data', () => gate);
  const one = h.whoop(A);
  while (fake.count.data < 8) await new Promise(r => setTimeout(r, 5));
  const two = h.whoop(A);
  await new Promise(r => setTimeout(r, 200));
  release();
  const [r1, r2] = await Promise.all([one, two]);
  assert.equal(fake.count.data, 8, 'the second read joined the fetch in flight');
  assert.deepEqual(r1.json(), r2.json());
  assert.equal(r1.json().fetchedAt, iso(T0 + 10 * MIN));

  // B is cached apart from A.
  await h.connect(B);
  assert.equal((await h.whoop(B)).json().fetchedAt, iso(T0 + 10 * MIN));
  assert.equal(fake.count.data, 12);

  // Connecting again (perhaps another WHOOP account) never serves the old read.
  await h.connect(A);
  await h.whoop(A);
  assert.equal(fake.count.data, 16, 'a new connection reads afresh');
  h.assertNoLeak();
});

test('WHOOP rate-limited or down: the last good read with stale true, or an error with nothing cached', async t => {
  const fake = await whoopFake(t);
  const h = await boot(t, { fake });
  await h.connect(A);
  const good = (await h.whoop(A)).json();

  await h.at(T0 + 11 * MIN);
  fake.force('data', 429, 429, 429, 429);
  const stale = (await h.whoop(A)).json();
  assert.deepEqual(stale, { ...good, stale: true }, 'the last good read, as of when it was fetched');

  fake.force('data', 503, 503, 503, 503);
  assert.deepEqual((await h.whoop(A)).json(), { ...good, stale: true });
  fake.force('data', 'drop', 'drop', 'drop', 'drop');
  assert.deepEqual((await h.whoop(A)).json(), { ...good, stale: true });

  // A profile with nothing cached gets a plain error.
  await h.connect(B);
  fake.force('data', 429, 429, 429, 429);
  assert.deepEqual((await h.whoop(B)).json(), { configured: true, connected: true, fetchedAt: null, stale: false, error: 'unavailable', days: [], workouts: [] });

  // Back up: a fresh read, not stale.
  const back = (await h.whoop(A)).json();
  assert.equal(back.stale, false);
  assert.equal(back.fetchedAt, iso(T0 + 11 * MIN));
  h.assertNoLeak();
});

test('a grant WHOOP has dropped reads as not connected, and stays that way', async t => {
  const fake = await whoopFake(t);
  const h = await boot(t, { fake });
  await h.connect(A);
  await h.whoop(A);

  await h.at(T0 + 11 * MIN);
  fake.force('data', 401, 401, 401, 401);
  fake.force('token', { status: 400, body: { error: 'invalid_grant' } });
  assert.deepEqual((await h.whoop(A)).json(), NOT_CONNECTED);
  assert.equal(fs.existsSync(h.file(A)), false, 'the dead pair is gone');
  const before = fake.count.data;
  assert.deepEqual((await h.whoop(A)).json(), NOT_CONNECTED, 'and the old read is not served from the cache');
  assert.equal(fake.count.data, before);
  h.assertNoLeak();
});

test('disconnect revokes at WHOOP, and removes the file even when WHOOP is down', async t => {
  const fake = await whoopFake(t);
  const h = await boot(t, { fake });

  await h.connect(A);
  await h.whoop(A);
  let off = await h.req('POST', '/api/whoop/disconnect', { as: A });
  assert.equal(off.status, 200);
  assert.deepEqual(off.json(), { ok: true, revoked: true, wasConnected: true });
  assert.equal(fake.count.revoke, 1);
  assert.equal(fs.existsSync(h.file(A)), false);
  assert.deepEqual((await h.whoop(A)).json(), NOT_CONNECTED, 'the cache went with it');

  await h.connect(A);
  await h.whoop(A);
  fake.force('revoke', 'drop');
  off = await h.req('POST', '/api/whoop/disconnect', { as: A });
  assert.deepEqual(off.json(), { ok: true, revoked: false, wasConnected: true }, 'says WHOOP was not told');
  assert.equal(fs.existsSync(h.file(A)), false, 'the tokens are gone anyway');
  assert.deepEqual((await h.whoop(A)).json(), NOT_CONNECTED);

  await h.connect(A);
  fake.force('revoke', 503);
  off = await h.req('POST', '/api/whoop/disconnect', { as: A });
  assert.deepEqual(off.json(), { ok: true, revoked: false, wasConnected: true });
  assert.equal(fs.existsSync(h.file(A)), false);
  h.assertNoLeak();
});

test("disconnect voids the profile's unused links, so a tab left open cannot reconnect it", async t => {
  const fake = await whoopFake(t);
  const h = await boot(t, { fake });
  const c = new URL((await h.req('POST', '/api/whoop/connect-link', { as: A })).json().url).searchParams.get('c');
  const c2 = new URL((await h.req('POST', '/api/whoop/connect-link', { as: A })).json().url).searchParams.get('c');
  const state = new URL((await h.req('GET', `/api/whoop/connect?c=${c}`)).headers.get('location')).searchParams.get('state');
  await h.req('POST', '/api/whoop/disconnect', { as: A });
  assert.equal(pageText((await h.req('GET', `/api/whoop/callback?code=${fake.issueCode()}&state=${state}`)).text), EXPIRED);
  assert.equal(pageText((await h.req('GET', `/api/whoop/connect?c=${c2}`)).text), EXPIRED);
  assert.equal(fs.existsSync(h.file(A)), false);
  h.assertNoLeak();
});

test("the phone's bearer works on both POSTs from any origin; a browser's cookie only from ORIGIN", async t => {
  const fake = await whoopFake(t);
  const h = await boot(t, { fake });
  const elsewhere = { Origin: 'capacitor://localhost' };

  assert.equal((await h.req('POST', '/api/whoop/connect-link', { as: A, headers: elsewhere })).status, 200);
  assert.equal((await h.req('POST', '/api/whoop/disconnect', { as: A, headers: elsewhere })).status, 200);

  const cookie = { Cookie: `gymsid=${token(A, 'c')}` };
  for (const p of ['/api/whoop/connect-link', '/api/whoop/disconnect']) {
    assert.equal((await h.req('POST', p, { headers: { ...cookie, Origin: 'https://evil.example' } })).status, 403, `${p} cross-origin`);
    assert.equal((await h.req('POST', p, { headers: { ...cookie, 'Sec-Fetch-Site': 'same-site' } })).status, 403, `${p} from a sibling`);
    assert.equal((await h.req('POST', p, { headers: { ...cookie, Origin: ORIGIN } })).status, 200, `${p} same origin`);
  }
  assert.equal((await h.req('GET', '/api/whoop', { headers: cookie })).status, 200, 'the read takes the cookie too');
  h.assertNoLeak();
});

test('deleting a profile revokes its WHOOP grant and removes its token file', async t => {
  const fake = await whoopFake(t);
  const h = await boot(t, { fake });
  await h.connect(A);
  await h.connect(B);
  const del = await h.req('POST', '/api/admin/user/delete', { headers: { Cookie: `gymsid=${token(ADMIN, 'c')}`, Origin: ORIGIN }, body: { id: A } });
  assert.equal(del.status, 200, del.text);
  for (let i = 0; i < 200 && fs.existsSync(h.file(A)); i++) await new Promise(r => setTimeout(r, 10));
  assert.equal(fs.existsSync(h.file(A)), false);
  assert.equal(fake.count.revoke, 1, 'asked WHOOP to drop the grant');
  assert.equal(fs.existsSync(h.file(B)), true, "B's connection is untouched");
  h.assertNoLeak();
});
