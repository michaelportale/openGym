/* The WHOOP routes (Phase 8, Task 4): connect-link, the confirmation page and its Continue,
   the callback, the read and disconnect, against the real server.js in a child and the fake WHOOP
   in this process.

   What has to hold, because this server keeps the owner's real data and the WHOOP grant opens a
   third-party account:
   - one user never sees, connects or disconnects another's WHOOP;
   - a link code and a state are each good once, for ten minutes, for the uid they were made for,
     and the link names that profile before anything is used up;
   - no token and no client secret ever reaches a response, a page, a log line or a file in clear.

   The server's Date.now() is driven by test/fake-clock.mjs, so the time edges are exact. */
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
const A = 'whoopUserA_1', B = 'whoopUserB_1', C = 'whoopUserC_1', ADMIN = 'whoopAdmin_1';
const HOSTILE_NAME = `<script>alert("x")</script> & 'Co'`;
const MIN = 60000, DAY = 86400000;
// Noon UTC today: the window and the seeded records never straddle a UTC midnight.
const T0 = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate(), 12);
const iso = ms => new Date(ms).toISOString();
const TODAY = iso(T0).slice(0, 10);
const sleep = ms => new Promise(r => setTimeout(r, ms));

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
const confirmText = name => `Connect WHOOP to the openGym profile ${name}? `
  + 'Only continue if you opened this link yourself from the openGym app. Continue';
// How a browser submits the page's form: same origin, an empty form body.
const SAME_ORIGIN = { Origin: ORIGIN, 'Sec-Fetch-Site': 'same-origin' };
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

/** A server.js child (WHOOP configured against `fake` unless `fake` is null; `env` on top) with
 * users A, B, C (a hostile name) and an admin, its clock at T0, and every response and log line
 * kept for the leak scan. */
async function boot(t, { fake, env: extra = {} } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-whoop-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  const created = new Date().toISOString();
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
    users: [{ id: A, name: 'Ann', created }, { id: B, name: 'Bea', created }, { id: C, name: HOSTILE_NAME, created }, { id: ADMIN, name: 'Adm', created, admin: true }],
    creds: [], subs: [], invites: []
  }));
  // A WHOOP_* in the shell running the tests must not configure the "not configured" server.
  const { WHOOP_CLIENT_ID, WHOOP_CLIENT_SECRET, WHOOP_BASE_URL, ...env } = process.env;
  const child = spawn(process.execPath, ['--import', './test/fake-clock.mjs', 'server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: {
      ...env, PORT: '0', DATA_DIR: dataDir, ORIGIN, RP_ID: 'localhost',
      ...(fake ? { WHOOP_CLIENT_ID: fake.clientId, WHOOP_CLIENT_SECRET: fake.clientSecret, WHOOP_BASE_URL: fake.url } : {}),
      ...extra
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
    /** A request as the phone makes it (`as`: a bearer for that uid), as a browser (`headers`),
     * with a JSON `body`, or (`form`) with the empty form body a submitted <form> sends. */
    async req(method, p, { as, headers = {}, body, form } = {}) {
      const r = await fetch(api + p, {
        method, redirect: 'manual',
        headers: {
          ...(as ? { Authorization: `Bearer ${token(as)}` } : {}),
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
          ...headers
        },
        ...(body ? { body: JSON.stringify(body) } : form ? { body: '' } : {})
      });
      const text = await r.text();
      seen.push(`${method} ${p} -> ${r.status} ${JSON.stringify([...r.headers])}\n${text}`);
      return { status: r.status, headers: r.headers, text, json: () => JSON.parse(text) };
    },
    whoop: uid => h.req('GET', '/api/whoop', { as: uid }),
    /** A fresh link code for `uid`, from the phone. */
    async link(uid) {
      const r = await h.req('POST', '/api/whoop/connect-link', { as: uid });
      assert.equal(r.status, 200, log);
      return new URL(r.json().url).searchParams.get('c');
    },
    /** The page the link opens. */
    page: c => h.req('GET', `/api/whoop/connect?c=${encodeURIComponent(c)}`),
    /** The cookie Continue last set: the one browser most tests walk the flow in. */
    jar: '',
    /** Continue on that page, as the browser submits its form; keeps the cookie it sets. */
    async confirm(c, headers = SAME_ORIGIN) {
      const r = await h.req('POST', `/api/whoop/connect?c=${encodeURIComponent(c)}`, { form: true, headers });
      const set = r.headers.get('set-cookie');
      if (set) h.jar = set.split(';')[0];
      return r;
    },
    /** The state in the WHOOP URL that Continue sends the browser to. */
    async stateFor(uid) {
      const r = await h.confirm(await h.link(uid));
      assert.equal(r.status, 302, r.text);
      return new URL(r.headers.get('location')).searchParams.get('state');
    },
    /** WHOOP sending the browser back: by default the browser that pressed Continue (`jar`). */
    callback: (state, { code = fake.issueCode(), headers = {}, jar = h.jar, query } = {}) => {
      const cookie = [jar, headers.Cookie].filter(Boolean).join('; ');
      return h.req('GET', `/api/whoop/callback?${query ?? `code=${encodeURIComponent(code)}`}&state=${encodeURIComponent(state)}`,
        { headers: { ...headers, ...(cookie ? { Cookie: cookie } : {}) } });
    },
    /** Link, page, Continue and callback for `uid`, as Safari would walk it. */
    async connect(uid) {
      const c = await h.link(uid);
      assert.equal((await h.page(c)).status, 200);
      const state = new URL((await h.confirm(c)).headers.get('location')).searchParams.get('state');
      const cb = await h.callback(state);
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
const UNAVAILABLE = { configured: true, connected: true, fetchedAt: null, stale: false, error: 'unavailable', days: [], workouts: [] };

test('the full connect flow: link, page, Continue, WHOOP, callback, then GET /api/whoop is filled', async t => {
  const fake = await whoopFake(t);
  const h = await boot(t, { fake });

  assert.deepEqual((await h.whoop(A)).json(), NOT_CONNECTED);

  const link = await h.req('POST', '/api/whoop/connect-link', { as: A });
  assert.equal(link.status, 200);
  const { url } = link.json();
  assert.match(url, /^http:\/\/localhost:8080\/api\/whoop\/connect\?c=[A-Za-z0-9_-]{43}$/, 'a 32-byte base64url code on ORIGIN');
  const c = new URL(url).searchParams.get('c');

  const page = await h.req('GET', new URL(url).pathname + new URL(url).search);
  assert.equal(page.status, 200);
  assert.equal(pageText(page.text), confirmText('Ann'));

  const go = await h.confirm(c);
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
  assert.notEqual(state, c, 'the state is not the link code');

  const cb = await h.callback(state);
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

test('the link opens a page that names the profile, uses nothing up, and cannot be framed', async t => {
  const fake = await whoopFake(t);
  const h = await boot(t, { fake });
  const c = await h.link(A);

  for (const n of [1, 2]) {
    const page = await h.page(c);
    assert.equal(page.status, 200, `GET ${n}`);
    assert.equal(pageText(page.text), confirmText('Ann'), `GET ${n} shows the page, the code still unused`);
  }
  const page = await h.page(c);
  assert.equal(page.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.equal(page.headers.get('cache-control'), 'no-store');
  assert.equal(page.headers.get('x-frame-options'), 'DENY');
  const csp = page.headers.get('content-security-policy');
  assert.match(csp, /(^|; )default-src 'none'(;|$)/);
  assert.match(csp, /(^|; )frame-ancestors 'none'(;|$)/);
  assert.ok(!/unsafe-inline/.test(csp), csp);
  assert.ok(!/<script/i.test(page.text));
  // A same-origin POST back to the same path; the code rides in the action's query, not a body.
  const form = /<form method="post" action="([^"]+)">/.exec(page.text);
  assert.ok(form, page.text);
  assert.equal(new URL(form[1].replace(/&amp;/g, '&'), `${ORIGIN}/api/whoop/connect?c=${c}`).href, `${ORIGIN}/api/whoop/connect?c=${c}`);
  assert.equal(fake.log.length, 0, 'nothing reached WHOOP before Continue');

  // A name with markup in it is text on the page.
  const hostile = await h.page(await h.link(C));
  assert.ok(!hostile.text.includes('<script>alert'), hostile.text);
  assert.ok(hostile.text.includes('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;Co&#39;'), hostile.text);
  assert.equal(pageText(hostile.text), confirmText(HOSTILE_NAME));
  h.assertNoLeak();
});

test('Continue: refused from another site, a redirect to WHOOP from the page itself, and good once', async t => {
  const fake = await whoopFake(t);
  const h = await boot(t, { fake });
  const c = await h.link(A);

  for (const headers of [
    { Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site' },
    { Origin: 'https://evil.example' },
    { Origin: 'https://other.localhost:8080', 'Sec-Fetch-Site': 'same-site' },
  ]) {
    const r = await h.confirm(c, headers);
    assert.equal(r.status, 403, JSON.stringify(headers));
    assert.equal(r.headers.get('location'), null);
  }
  // A bearer buys nothing here: the code is the credential, and the origin check still applies.
  assert.equal((await h.req('POST', `/api/whoop/connect?c=${c}`, { as: A, form: true, headers: { Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  assert.equal(pageText((await h.page(c)).text), confirmText('Ann'), 'a refused POST used nothing up');

  const go = await h.confirm(c);
  assert.equal(go.status, 302);
  assert.equal(new URL(go.headers.get('location')).origin, fake.url);
  // A browser without Sec-Fetch-Site still sends its Origin on the form POST.
  assert.equal((await h.confirm(await h.link(A), { Origin: ORIGIN })).status, 302);

  const again = await h.confirm(c);
  assert.equal(again.status, 400);
  assert.equal(pageText(again.text), USED, 'a replayed Continue');
  assert.equal(pageText((await h.page(c)).text), USED, 'and the page says so too');
  h.assertNoLeak();
});

test("WHOOP's URL alone is not enough: the callback must come back to the browser that pressed Continue", async t => {
  const fake = await whoopFake(t);
  const h = await boot(t, { fake });
  const BROWSER = failed("it didn't come back to the browser it started in");

  // Someone presses Continue on their own link (curl will do) and sends the WHOOP URL it
  // redirects to to someone else, who signs in at WHOOP: their browser never pressed Continue.
  const go = await h.confirm(await h.link(A));
  const set = go.headers.get('set-cookie');
  assert.match(set, /^gymwhoop=[A-Za-z0-9_-]{43}; Path=\/; Max-Age=600; HttpOnly; SameSite=Lax$/, set);
  const state = new URL(go.headers.get('location')).searchParams.get('state');
  const other = await h.callback(state, { jar: '' });
  assert.equal(other.status, 400);
  assert.equal(pageText(other.text), BROWSER);
  assert.equal(fake.count.authorization_code, 0, 'never exchanged');
  assert.equal(fs.existsSync(h.file(A)), false, 'nothing stored for the sender');
  assert.equal(pageText((await h.callback(state)).text), USED, 'and the state is gone, even for the right browser');

  // A different browser's cookie, or two of them, will not do either.
  for (const jar of [`gymwhoop=${crypto.randomBytes(32).toString('base64url')}`, 'gymwhoop=short', '']) {
    const s = await h.stateFor(A);
    const right = h.jar;
    const wrong = jar === '' ? `${right}; gymwhoop=${crypto.randomBytes(32).toString('base64url')}` : jar;
    assert.equal(pageText((await h.callback(s, { jar: wrong })).text), BROWSER, wrong);
  }
  assert.equal(fake.count.authorization_code, 0);

  // The browser that pressed Continue connects.
  const s = await h.stateFor(A);
  assert.equal(pageText((await h.callback(s)).text), SUCCESS);

  // Each Continue sets a fresh value: a cookie planted before it is replaced, not adopted.
  const planted = `gymwhoop=${crypto.randomBytes(32).toString('base64url')}`;
  const again = await h.confirm(await h.link(B), { ...SAME_ORIGIN, Cookie: planted });
  assert.notEqual(again.headers.get('set-cookie').split(';')[0], planted);
  h.assertNoLeak();
});

test('on an https ORIGIN the browser cookie is __Host- and Secure', async t => {
  const fake = await whoopFake(t);
  const h = await boot(t, { fake, env: { ORIGIN: 'https://gym.test', RP_ID: 'gym.test' } });
  const go = await h.confirm(await h.link(A), { Origin: 'https://gym.test', 'Sec-Fetch-Site': 'same-origin' });
  assert.equal(go.status, 302, go.text);
  assert.match(go.headers.get('set-cookie'), /^__Host-gymwhoop=[A-Za-z0-9_-]{43}; Path=\/; Max-Age=600; HttpOnly; Secure; SameSite=Lax$/);
  // The callback expires it under the same name and attributes.
  const cb = await h.req('GET', '/api/whoop/callback?code=x&state=y');
  assert.equal(cb.headers.get('set-cookie'), '__Host-gymwhoop=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax');
});

test('a state is good once, unknown values expire, and nothing from the query is echoed', async t => {
  const fake = await whoopFake(t);
  const h = await boot(t, { fake });

  const { state } = await h.connect(A);
  const replay = await h.callback(state);
  assert.equal(replay.status, 400);
  assert.equal(pageText(replay.text), USED, 'a replayed state');
  assert.equal(fake.count.authorization_code, 1, 'a replayed state never reaches WHOOP');

  for (const q of ['', '?c=', '?c=nope', `?c=${crypto.randomBytes(32).toString('base64url')}`]) {
    for (const m of ['GET', 'POST']) {
      const r = await h.req(m, `/api/whoop/connect${q}`, { form: m === 'POST', headers: m === 'POST' ? SAME_ORIGIN : {} });
      assert.equal(r.status, 400, `${m} ${q}`);
      assert.equal(pageText(r.text), EXPIRED, `${m} ${q}`);
    }
  }
  for (const q of ['', '?code=x', `?code=x&state=${crypto.randomBytes(32).toString('base64url')}`]) {
    const r = await h.req('GET', `/api/whoop/callback${q}`);
    assert.equal(r.status, 400, q);
    assert.equal(pageText(r.text), EXPIRED, q);
  }

  // A value from the query never reaches the page, escaped or not.
  const marker = '<script>alert("MARK-3f9")</script>';
  for (const [m, p] of [['GET', `/api/whoop/connect?c=${encodeURIComponent(marker)}`], ['POST', `/api/whoop/connect?c=${encodeURIComponent(marker)}`],
    ['GET', `/api/whoop/callback?code=${encodeURIComponent(marker)}&state=${encodeURIComponent(marker)}`]]) {
    const r = await h.req(m, p, { form: m === 'POST', headers: m === 'POST' ? SAME_ORIGIN : {} });
    assert.ok(!r.text.includes('MARK-3f9'), r.text);
    assert.ok(!r.text.includes('<script'), r.text);
  }

  // Six codes for one profile: only the newest five are kept, so a loop cannot grow the table.
  const codes = [];
  for (let i = 0; i < 6; i++) codes.push(await h.link(B));
  assert.equal(pageText((await h.page(codes[0])).text), EXPIRED, 'the oldest was dropped');
  assert.equal((await h.confirm(codes[1])).status, 302, 'the second still works');
  h.assertNoLeak();
});

test('the callback: WHOOP refusing, a denied consent and WHOOP down each give their reason and use the state up', async t => {
  const fake = await whoopFake(t);
  const h = await boot(t, { fake });

  // The person said no at WHOOP: WHOOP comes back with error=access_denied and no code.
  let state = await h.stateFor(A);
  let r = await h.callback(state, { query: 'error=access_denied&error_description=nope' });
  assert.equal(r.status, 400);
  assert.equal(pageText(r.text), SAID_NO);
  assert.equal(pageText((await h.callback(state)).text), USED, 'the state went with the refusal');

  // WHOOP refuses the code (invalid_grant).
  r = await h.callback(await h.stateFor(A), { code: 'not-a-real-code' });
  assert.equal(pageText(r.text), SAID_NO);

  // Every permission has to be granted.
  state = await h.stateFor(A);
  fake.override = { scope: 'read:recovery offline' };
  assert.equal(pageText((await h.callback(state)).text), SAID_NO);

  // WHOOP down at the token endpoint.
  state = await h.stateFor(A);
  fake.force('token', 503);
  r = await h.callback(state);
  assert.equal(r.status, 502);
  assert.equal(pageText(r.text), UNREACHABLE);
  state = await h.stateFor(A);
  fake.force('token', 'drop');
  assert.equal(pageText((await h.callback(state)).text), UNREACHABLE);

  assert.equal(fs.existsSync(h.file(A)), false, 'none of that connected anything');
  assert.deepEqual((await h.whoop(A)).json(), NOT_CONNECTED);
  h.assertNoLeak();
});

test('a link code and a state expire ten minutes after they were made (fake clock)', async t => {
  const fake = await whoopFake(t);
  const h = await boot(t, { fake });

  const [c1, c2, c3] = [await h.link(A), await h.link(A), await h.link(A)];
  await h.at(T0 + 10 * MIN - 1);
  assert.equal((await h.page(c1)).status, 200, 'the page shows until the last millisecond');
  assert.equal((await h.confirm(c1)).status, 302, 'and Continue works then');
  await h.at(T0 + 10 * MIN);
  const late = await h.page(c2);
  assert.equal(late.status, 400);
  assert.equal(pageText(late.text), EXPIRED);
  assert.equal(pageText((await h.confirm(c2)).text), EXPIRED);
  await h.at(T0 + 60 * MIN);
  assert.equal(pageText((await h.confirm(c3)).text), EXPIRED);

  // A state minted now is dead ten minutes on, before any exchange.
  const T1 = T0 + 2 * 60 * MIN;
  await h.at(T1);
  const state = await h.stateFor(A);
  await h.at(T1 + 10 * MIN);
  assert.equal(pageText((await h.callback(state)).text), EXPIRED);
  assert.equal(fake.count.authorization_code, 0, 'an expired state never reaches WHOOP');
  assert.equal(fs.existsSync(h.file(A)), false);
  h.assertNoLeak();
});

test("a state made for A stores A's tokens whoever is signed in, and B can neither read nor disconnect A", async t => {
  const fake = await whoopFake(t);
  const h = await boot(t, { fake });

  const state = await h.stateFor(A);
  // The browser finishing A's flow is signed in as B, both ways.
  const cb = await h.callback(state, { headers: { Authorization: `Bearer ${token(B)}`, Cookie: `gymsid=${token(B, 'c')}` } });
  assert.equal(pageText(cb.text), SUCCESS);
  assert.equal(fs.existsSync(h.file(A)), true, 'stored for the uid the state was made for');
  assert.equal(fs.existsSync(h.file(B)), false, 'never for the caller');

  assert.deepEqual((await h.whoop(B)).json(), NOT_CONNECTED);
  assert.equal((await h.whoop(A)).json().connected, true);

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
  for (const m of ['GET', 'POST']) {
    const go = await h.req(m, '/api/whoop/connect?c=anything', { form: m === 'POST', headers: m === 'POST' ? SAME_ORIGIN : {} });
    assert.equal(go.status, 400);
    assert.equal(pageText(go.text), EXPIRED);
  }
  assert.equal(pageText((await h.req('GET', '/api/whoop/callback?code=x&state=y')).text), EXPIRED);
  assert.deepEqual((await h.req('POST', '/api/whoop/disconnect', { as: A })).json(), { ok: true, revoked: false, wasConnected: false });

  for (const [m, p] of [['GET', '/api/whoop'], ['POST', '/api/whoop/connect-link'], ['POST', '/api/whoop/disconnect']]) {
    assert.equal((await h.req(m, p)).status, 401, `${m} ${p} without a session`);
  }
});

test('WHOOP_BASE_URL is honoured only on a loopback host, and anything else is ignored without being printed', async t => {
  const creds = { WHOOP_CLIENT_ID: 'base-test-id', WHOOP_CLIENT_SECRET: 'base-test-secret' };
  const authorizeOrigin = async h => new URL((await h.confirm(await h.link(A))).headers.get('location')).origin;

  for (const bad of ['http://whoop-evil.example:8443', 'http://127.0.0.1.whoop-evil.example', 'http://localhost.whoop-evil.example:80', 'not a url whoop-evil']) {
    const h = await boot(t, { fake: null, env: { ...creds, WHOOP_BASE_URL: bad } });
    assert.equal(await authorizeOrigin(h), 'https://api.prod.whoop.com', bad);
    assert.match(h.log(), /WHOOP_BASE_URL/, 'a warning at boot');
    assert.ok(!h.log().includes('whoop-evil'), `the value is never printed:\n${h.log()}`);
  }
  for (const [good, origin] of [['http://[::1]:9', 'http://[::1]:9'], ['http://localhost:9/', 'http://localhost:9'], ['http://127.0.0.1:9', 'http://127.0.0.1:9']]) {
    const h = await boot(t, { fake: null, env: { ...creds, WHOOP_BASE_URL: good } });
    assert.equal(await authorizeOrigin(h), origin, good);
    assert.ok(!/WHOOP_BASE_URL/.test(h.log()), h.log());
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
  while (fake.count.data < 8) await sleep(5);
  const two = h.whoop(A);
  await sleep(200);
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

test('a fetch still out across a disconnect and a reconnect never plants its read in the cache', async t => {
  const fake = await whoopFake(t);
  const h = await boot(t, { fake });
  await h.connect(A);
  await h.whoop(A);
  assert.equal(fake.count.data, 4);

  await h.at(T0 + 11 * MIN);
  let release;
  const gate = new Promise(r => { release = r; });
  fake.force('data', () => gate);
  const one = h.whoop(A);
  while (fake.count.data < 8) await sleep(5);
  fake.force('revoke', 'drop');                 // WHOOP unreachable: the old token stays live at the fake
  assert.deepEqual((await h.req('POST', '/api/whoop/disconnect', { as: A })).json(), { ok: true, revoked: false, wasConnected: true });
  await h.connect(A);                           // a new connection while the old fetch is still out
  await h.at(T0 + 12 * MIN);
  release();
  assert.equal((await one).json().connected, true, 'the read that started it still gets its answer');

  const before = fake.count.data;
  const next = (await h.whoop(A)).json();
  assert.equal(fake.count.data, before + 4, 'the next read fetched afresh: the old fetch did not cache');
  assert.equal(next.fetchedAt, iso(T0 + 12 * MIN));
  h.assertNoLeak();
});

test('WHOOP rate-limited or down: the last good read with stale true, or an error with nothing cached', async t => {
  const fake = await whoopFake(t);
  const h = await boot(t, { fake });
  await h.connect(A);
  const good = (await h.whoop(A)).json();

  await h.at(T0 + 11 * MIN);
  fake.force('data', 429, 429, 429, 429);
  assert.deepEqual((await h.whoop(A)).json(), { ...good, stale: true }, 'the last good read, as of when it was fetched');
  await h.at(T0 + 12 * MIN);
  fake.force('data', 503, 503, 503, 503);
  assert.deepEqual((await h.whoop(A)).json(), { ...good, stale: true });
  await h.at(T0 + 13 * MIN);
  fake.force('data', 'drop', 'drop', 'drop', 'drop');
  assert.deepEqual((await h.whoop(A)).json(), { ...good, stale: true });

  // A profile with nothing cached gets a plain error.
  await h.connect(B);
  fake.force('data', 429, 429, 429, 429);
  assert.deepEqual((await h.whoop(B)).json(), UNAVAILABLE);

  // Back up: a fresh read, not stale.
  await h.at(T0 + 14 * MIN);
  const back = (await h.whoop(A)).json();
  assert.equal(back.stale, false);
  assert.equal(back.fetchedAt, iso(T0 + 14 * MIN));
  h.assertNoLeak();
});

test('after WHOOP fails, the next minute of reads answers without asking WHOOP again', async t => {
  const fake = await whoopFake(t);
  const h = await boot(t, { fake });
  await h.connect(A);
  const good = (await h.whoop(A)).json();

  const T1 = T0 + 11 * MIN;
  await h.at(T1);
  fake.force('data', 429, 429, 429, 429);
  assert.deepEqual((await h.whoop(A)).json(), { ...good, stale: true });
  const after = fake.count.data;
  await h.at(T1 + MIN - 1);
  assert.deepEqual((await h.whoop(A)).json(), { ...good, stale: true }, 'stale, from the cache');
  assert.equal(fake.count.data, after, 'WHOOP left alone for a minute');
  await h.at(T1 + MIN);
  const fresh = (await h.whoop(A)).json();
  assert.equal(fake.count.data, after + 4, 'asked again after the minute');
  assert.equal(fresh.stale, false);
  assert.equal(fresh.fetchedAt, iso(T1 + MIN));

  // With nothing cached: the error shape, also without a call.
  await h.connect(B);
  fake.force('data', 503, 503, 503, 503);
  assert.deepEqual((await h.whoop(B)).json(), UNAVAILABLE);
  const quiet = fake.count.data;
  assert.deepEqual((await h.whoop(B)).json(), UNAVAILABLE);
  assert.equal(fake.count.data, quiet);

  // Disconnecting and connecting again starts clean.
  await h.req('POST', '/api/whoop/disconnect', { as: B });
  await h.connect(B);
  const clean = (await h.whoop(B)).json();
  assert.equal(fake.count.data, quiet + 4, 'a new connection reads at once');
  assert.equal(clean.connected, true);
  assert.equal(clean.stale, false);
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
  const state = await h.stateFor(A);
  const c2 = await h.link(A);
  await h.req('POST', '/api/whoop/disconnect', { as: A });
  assert.equal(pageText((await h.callback(state)).text), EXPIRED);
  assert.equal(pageText((await h.page(c2)).text), EXPIRED);
  assert.equal(pageText((await h.confirm(c2)).text), EXPIRED);
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
  for (let i = 0; i < 200 && fs.existsSync(h.file(A)); i++) await sleep(10);
  assert.equal(fs.existsSync(h.file(A)), false);
  assert.equal(fake.count.revoke, 1, 'asked WHOOP to drop the grant');
  assert.equal(fs.existsSync(h.file(B)), true, "B's connection is untouched");
  h.assertNoLeak();
});

test("the callback: a connection the server can't save gets the failure page, and the log has the reason only", async t => {
  const fake = await whoopFake(t);
  const h = await boot(t, { fake });
  const c = await h.link(A);
  const state = new URL((await h.confirm(c)).headers.get('location')).searchParams.get('state');
  const code = fake.issueCode();
  fs.mkdirSync(`${h.file(A)}.tmp`); // the vault's write cannot open its temp file, as on a full disk

  const r = await h.callback(state, { code });
  assert.equal(r.status, 500);
  assert.equal(r.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(pageText(r.text), failed("your server couldn't save the WHOOP connection"));
  assert.equal(fake.count.authorization_code, 1, 'WHOOP was asked; the code is spent');
  assert.equal(fs.existsSync(h.file(A)), false);
  assert.match(h.log(), /whoop: could not save the connection of whoopUserA_1: EISDIR/);
  for (const v of [c, state, code]) assert.ok(!h.log().includes(v), 'no link code, state or code in the log');
  assert.deepEqual((await h.whoop(A)).json(), NOT_CONNECTED);

  // Once the disk is fixed, Connect again works.
  fs.rmdirSync(`${h.file(A)}.tmp`);
  await h.connect(A);
  assert.equal((await h.whoop(A)).json().connected, true);
  h.assertNoLeak();
});

test('every callback outcome expires the browser cookie that Continue set', async t => {
  const fake = await whoopFake(t);
  const h = await boot(t, { fake });
  const EXPIRE = 'gymwhoop=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax';
  const outcomes = [];
  let state = await h.stateFor(A);
  outcomes.push(['connected', await h.callback(state)]);
  outcomes.push(['used', await h.callback(state)]);
  outcomes.push(['expired', await h.req('GET', '/api/whoop/callback?code=x&state=y')]);
  outcomes.push(['another browser', await h.callback(await h.stateFor(A), { jar: '' })]);
  outcomes.push(['said no', await h.callback(await h.stateFor(A), { query: 'error=access_denied' })]);
  state = await h.stateFor(A);
  fake.force('token', 503);
  outcomes.push(['unreachable', await h.callback(state)]);
  state = await h.stateFor(B);
  fs.mkdirSync(`${h.file(B)}.tmp`);
  outcomes.push(['not saved', await h.callback(state)]);
  for (const [name, r] of outcomes) assert.equal(r.headers.get('set-cookie'), EXPIRE, name);
  assert.deepEqual(outcomes.map(([, r]) => r.status), [200, 400, 400, 400, 400, 502, 500]);
  h.assertNoLeak();
});

test('any failed read leaves WHOOP alone for a minute, the server failing on its own side too', async t => {
  const fake = await whoopFake(t);
  const h = await boot(t, { fake });
  await h.connect(A);
  await h.whoop(A);

  // The normaliser throws on a record it cannot read: the server's own failure, a 500.
  const T1 = T0 + 11 * MIN;
  await h.at(T1);
  fake.page = p => ({ records: p === 'recovery' ? [null] : fake.records[p], next_token: null });
  assert.equal((await h.whoop(A)).status, 500);
  fake.page = null;
  let data = fake.count.data;
  await h.at(T1 + MIN - 1);
  const held = (await h.whoop(A)).json();
  assert.equal(held.stale, true, 'the last good read, marked stale');
  assert.equal(held.fetchedAt, iso(T0));
  assert.equal(fake.count.data, data, 'WHOOP left alone for the minute');
  await h.at(T1 + MIN);
  assert.equal((await h.whoop(A)).json().fetchedAt, iso(T1 + MIN), 'asked again after it');
  assert.equal(fake.count.data, data + 4);

  // The vault cannot save a refreshed pair (past the access token's hour, so the read refreshes
  // first): a 500 again, and again a minute with no refresh and no read.
  const T2 = T0 + 70 * MIN;
  await h.at(T2);
  fs.mkdirSync(`${h.file(A)}.tmp`);
  assert.equal((await h.whoop(A)).status, 500);
  const refreshes = fake.count.refresh_token;
  data = fake.count.data;
  await h.at(T2 + MIN - 1);
  assert.equal((await h.whoop(A)).json().stale, true);
  assert.equal(fake.count.refresh_token, refreshes, 'no second refresh inside the minute');
  assert.equal(fake.count.data, data);
  h.assertNoLeak();
});

test('WHOOP refusing even a fresh token: not connected, the pair kept, and WHOOP left alone for a minute', async t => {
  const fake = await whoopFake(t);
  const h = await boot(t, { fake });
  await h.connect(A);
  await h.whoop(A);

  const T1 = T0 + 11 * MIN;
  await h.at(T1);
  fake.force('data', ...Array(8).fill(401)); // each collection, before and after the refresh
  assert.deepEqual((await h.whoop(A)).json(), NOT_CONNECTED);
  while (fake.count.data < 12) await sleep(5); // the other three collections finish their two tries
  assert.equal(fake.count.refresh_token, 1);
  assert.equal(fs.existsSync(h.file(A)), true, 'the refreshed pair is kept');

  await h.at(T1 + MIN - 1);
  assert.deepEqual((await h.whoop(A)).json(), NOT_CONNECTED, 'the same answer, without asking WHOOP');
  assert.equal(fake.count.data, 12);
  assert.equal(fake.count.refresh_token, 1);
  await h.at(T1 + MIN);
  const back = (await h.whoop(A)).json();
  assert.equal(fake.count.data, 16, 'asked again after the minute');
  assert.equal(back.connected, true, 'and WHOOP took the kept token this time');
  assert.equal(back.stale, false);
  h.assertNoLeak();
});

test('connecting and disconnecting are in the audit log, with no token, link code, state or code', async t => {
  const fake = await whoopFake(t);
  const h = await boot(t, { fake, env: { AUDIT_LOG: '1' } });
  const auditText = () => { try { return fs.readFileSync(path.join(h.dataDir, 'audit.log'), 'utf8'); } catch { return ''; } };
  const rows = () => auditText().split('\n').filter(Boolean).map(l => JSON.parse(l));
  const whoopRows = () => rows().filter(r => r.ev.startsWith('whoop.')).map(r => [r.ev, r.ok, r.uid, r.name]);

  // A refused connect is not a connection.
  const refused = await h.stateFor(A);
  await h.callback(refused, { query: 'error=access_denied' });
  assert.deepEqual(whoopRows(), []);

  const c = await h.link(A);
  const state = new URL((await h.confirm(c)).headers.get('location')).searchParams.get('state');
  const code = fake.issueCode();
  assert.equal(pageText((await h.callback(state, { code })).text), SUCCESS);
  assert.deepEqual(whoopRows(), [['whoop.connect', true, A, 'Ann']]);
  assert.equal((await h.req('POST', '/api/whoop/disconnect', { as: A })).status, 200);
  assert.deepEqual(whoopRows(), [['whoop.connect', true, A, 'Ann'], ['whoop.disconnect', true, A, 'Ann']]);
  for (const v of [c, state, code, refused]) assert.ok(!auditText().includes(v), 'no link code, state or code');

  // Deleting a profile is logged once, as the delete it is.
  await h.connect(B);
  const del = await h.req('POST', '/api/admin/user/delete', { headers: { Cookie: `gymsid=${token(ADMIN, 'c')}`, Origin: ORIGIN }, body: { id: B } });
  assert.equal(del.status, 200, del.text);
  assert.equal(rows().filter(r => r.ev === 'admin.user.delete').length, 1);
  assert.deepEqual(whoopRows().filter(([, , uid]) => uid === B), [['whoop.connect', true, B, 'Bea']]);
  h.assertNoLeak(); // every token and the client secret, in every file under DATA_DIR: audit.log too
});
