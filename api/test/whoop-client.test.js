/* The WHOOP client against a fake WHOOP (test/fake-whoop.mjs). WHOOP rotates refresh tokens, so
 * the cases that matter most are the ones a careless client fails quietly: two refreshes racing
 * on one refresh token (the second gets a 400 and the owner is disconnected), a rotated pair used
 * before it is on disk, a dead refresh token kept around, and a revoke racing a refresh that then
 * writes the tokens back. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createWhoopVault, whoopFile } from '../whoop-vault.js';
import { createWhoopClient, WhoopError } from '../whoop-client.js';
import { startFakeWhoop, ALL_SCOPES } from './fake-whoop.mjs';

const SECRET = 'c'.repeat(64);
const START = '2026-10-24T00:00:00.000Z';
const COLLECTIONS = ['cycle', 'recovery', 'activity/sleep', 'activity/workout'];

async function setup(t, { wrapVault = v => v, fetch, clientSecret } = {}) {
  const fake = await startFakeWhoop();
  t.after(() => fake.close());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whoop-client-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const vault = createWhoopVault({ dir, secret: SECRET });
  const clock = { t: 1_800_000_000_000 };
  const make = (secret = fake.clientSecret) => createWhoopClient({
    base: fake.url, clientId: fake.clientId, clientSecret: secret, redirectUri: fake.redirectUri,
    vault: wrapVault(vault), now: () => clock.t, ...(fetch ? { fetch } : {}),
  });
  return { fake, vault, client: make(clientSecret), make, clock, dir };
}

/** A live pair in the vault for `uid`, expiring `ms` from the clock's now. */
function seed(ctx, uid, ms = 3_600_000) {
  const p = ctx.fake.issuePair();
  const stored = { access_token: p.access_token, refresh_token: p.refresh_token, expires_at: ctx.clock.t + ms, scope: p.scope };
  ctx.vault.save(uid, stored);
  return stored;
}

/** Rejects with a WhoopError of `code` whose message is the fixed string and leaks nothing. */
async function rejectsWith(ctx, promise, code) {
  await assert.rejects(promise, e => {
    assert.ok(e instanceof WhoopError, `expected a WhoopError, got ${e?.name}: ${e?.message}`);
    assert.equal(e.code, code);
    assert.equal(e.message, new WhoopError(code).message);
    const text = `${e.message}\n${e.stack}\n${JSON.stringify(e)}`;
    for (const s of ctx.fake.secrets()) assert.ok(!text.includes(s), 'the error carries a secret');
    assert.ok(!text.includes(ctx.fake.url), 'the error carries a URL');
    return true;
  });
}

/** A gate for fake.force: `reached` settles when the request arrives, `release()` lets it through. */
function gate() {
  let arrived, release;
  const reached = new Promise(r => { arrived = r; });
  const held = new Promise(r => { release = r; });
  return { reached, release, entry: async () => { arrived(); await held; } };
}

// ---- the fake itself -------------------------------------------------------------------------

test('the fake rotates: a refresh token used twice gets a 400, the old access token a 401', async t => {
  const { fake } = await setup(t);
  const pair = fake.issuePair();
  const refresh = () => fetch(`${fake.url}/oauth/oauth2/token`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: fake.clientId, client_secret: fake.clientSecret, grant_type: 'refresh_token', refresh_token: pair.refresh_token, scope: 'offline' }),
  });
  assert.equal((await refresh()).status, 200);
  assert.equal((await refresh()).status, 400);
  assert.equal(fake.isLive(pair.access_token), false);
});

// ---- authorize and exchange ------------------------------------------------------------------

test('authorizeUrl names the client, the exact redirect, every scope and the state, never the secret', async t => {
  const ctx = await setup(t);
  const u = new URL(ctx.client.authorizeUrl('state-123'));
  assert.equal(u.origin + u.pathname, `${ctx.fake.url}/oauth/oauth2/auth`);
  assert.equal(u.searchParams.get('client_id'), ctx.fake.clientId);
  assert.equal(u.searchParams.get('redirect_uri'), ctx.fake.redirectUri);
  assert.equal(u.searchParams.get('response_type'), 'code');
  assert.equal(u.searchParams.get('scope'), 'read:recovery read:cycles read:sleep read:workout offline');
  assert.equal(u.searchParams.get('state'), 'state-123');
  assert.ok(!u.href.includes(ctx.fake.clientSecret));
});

test('exchange saves a valid pair, with the client credentials in the form body', async t => {
  const ctx = await setup(t);
  assert.equal(ctx.client.connected('u1'), false);
  assert.equal(await ctx.client.exchange('u1', ctx.fake.issueCode()), undefined);
  const saved = ctx.vault.read('u1');
  assert.ok(ctx.fake.isLive(saved.access_token));
  assert.equal(saved.expires_at, ctx.clock.t + 3600 * 1000);
  assert.equal(saved.scope, ALL_SCOPES);
  assert.equal(ctx.client.connected('u1'), true);
  const req = ctx.fake.log.find(r => r.route === 'token');
  assert.equal(req.url, '/oauth/oauth2/token');
  assert.equal(req.auth, undefined);
  assert.equal(req.form.grant_type, 'authorization_code');
  assert.equal(req.form.redirect_uri, ctx.fake.redirectUri);
  assert.equal(req.form.client_id, ctx.fake.clientId);
  assert.equal(req.form.client_secret, ctx.fake.clientSecret);
});

test('exchange refuses an incomplete token response and saves nothing', async t => {
  const ctx = await setup(t);
  const bad = [
    { scope: 'read:recovery read:cycles read:sleep offline' },          // read:workout not granted
    { scope: 'read:recovery read:cycles read:sleep read:workout' },     // no offline
    { scope: undefined },
    { access_token: undefined },
    { access_token: '' },
    { refresh_token: undefined },
    { refresh_token: 42 },
    { expires_in: undefined },
    { expires_in: 0 },
    { expires_in: -60 },
    { expires_in: '3600' },
    { expires_in: null },
    { token_type: 'mac' },
    { token_type: undefined },
    'not json at all',
  ];
  for (const override of bad) {
    ctx.fake.override = override;
    await rejectsWith(ctx, ctx.client.exchange('u1', ctx.fake.issueCode()), 'incomplete');
    assert.equal(ctx.vault.read('u1'), null, `saved despite ${JSON.stringify(override)}`);
  }
  ctx.fake.override = { token_type: 'Bearer' };
  await ctx.client.exchange('u1', ctx.fake.issueCode());
  assert.ok(ctx.vault.read('u1'));
});

test('a refused code says reconnect and leaves an existing connection alone', async t => {
  const ctx = await setup(t);
  const before = seed(ctx, 'u1');
  await rejectsWith(ctx, ctx.client.exchange('u1', 'not-a-code'), 'reconnect');
  assert.deepEqual(ctx.vault.read('u1'), before);
  ctx.fake.force('token', 503);
  await rejectsWith(ctx, ctx.client.exchange('u1', ctx.fake.issueCode()), 'unavailable');
  assert.deepEqual(ctx.vault.read('u1'), before);
});

// ---- refresh timing, serialisation, persist-before-use ---------------------------------------

test('refresh happens at expires_at - 60s, not before', async t => {
  const ctx = await setup(t);
  const old = seed(ctx, 'u1', 60_001);
  await ctx.client.get('u1', 'cycle');
  assert.equal(ctx.fake.count.refresh_token, 0);
  ctx.clock.t += 1;
  await ctx.client.get('u1', 'cycle');
  assert.equal(ctx.fake.count.refresh_token, 1);
  const now = ctx.vault.read('u1');
  assert.notEqual(now.refresh_token, old.refresh_token);
  assert.equal(now.expires_at, ctx.clock.t + 3600 * 1000);
  const refresh = ctx.fake.log.find(r => r.route === 'token').form;
  assert.equal(refresh.grant_type, 'refresh_token');
  assert.equal(refresh.scope, 'offline');
  assert.equal(refresh.refresh_token, old.refresh_token);
});

test('concurrent gets share one refresh: they await the same lookup', async t => {
  let reads = 0;
  const ctx = await setup(t, { wrapVault: v => ({ ...v, read(uid) { reads++; return v.read(uid); } }) });
  seed(ctx, 'u1', 0);
  for (const c of COLLECTIONS) ctx.fake.records[c] = [{ id: `${c}-1` }];
  const results = await Promise.all([...COLLECTIONS, 'cycle'].map(c => ctx.client.get('u1', c, { start: START })));
  assert.equal(ctx.fake.count.refresh_token, 1);
  assert.equal(reads, 1);
  assert.deepEqual(results.map(r => r[0].id), [...COLLECTIONS, 'cycle'].map(c => `${c}-1`));
  assert.ok(ctx.fake.isLive(ctx.vault.read('u1').access_token));
});

test('two concurrent 401s on one access token refresh once; the second caller reuses the new pair', async t => {
  const ctx = await setup(t);
  seed(ctx, 'u1');
  ctx.fake.force('data', 401, 401);
  await Promise.all([ctx.client.get('u1', 'cycle'), ctx.client.get('u1', 'recovery')]);
  assert.equal(ctx.fake.count.refresh_token, 1);
  assert.equal(ctx.fake.count.data, 4);
});

test('a caller whose token was just rejected never joins a lookup that can hand that token back', async t => {
  // A failed exchange holds the queue; a plain lookup queues behind it and will return T1, which
  // the vault still holds; then another caller's T1 is rejected. That caller must queue a lookup
  // of its own, which refreshes. Joining the plain one hands it the dead T1 back, and its retry
  // ends in a spurious reconnect.
  let rejected;
  const sawReject = new Promise(r => { rejected = r; });
  const ctx = await setup(t, { fetch: async (url, init) => { const r = await fetch(url, init); if (r.status === 401) rejected(); return r; } });
  const t1 = seed(ctx, 'u1').access_token;
  const held = gate();
  ctx.fake.force('data', held.entry);
  const first = ctx.client.get('u1', 'recovery');           // its call with T1 is held at WHOOP
  await held.reached;
  const ex = gate();
  ctx.fake.force('token', ex.entry);
  const exchange = ctx.client.exchange('u1', 'not-a-code');  // holds the queue, then fails
  await ex.reached;
  const second = ctx.client.get('u1', 'cycle');             // a plain lookup, queued behind it
  ctx.fake.killAccess(t1);                                   // WHOOP stops honouring T1
  held.release();                                            // the first call gets its 401 now
  await sawReject;
  await new Promise(r => setImmediate(r));                   // and has asked for a token that is not T1
  ex.release();
  await rejectsWith(ctx, exchange, 'reconnect');
  assert.deepEqual(await first, []);
  assert.deepEqual(await second, []);
  assert.equal(ctx.fake.count.refresh_token, 1);
});

test('refresh is per uid: one user\'s stuck refresh does not hold up another\'s reads', async t => {
  const ctx = await setup(t);
  seed(ctx, 'a', 0);
  seed(ctx, 'b');
  const g = gate();
  ctx.fake.force('token', g.entry);
  const a = ctx.client.get('a', 'cycle');
  await g.reached;
  assert.deepEqual(await ctx.client.get('b', 'cycle'), []);
  g.release();
  assert.deepEqual(await a, []);
  assert.equal(ctx.fake.count.refresh_token, 1);
});

test('the rotated pair is on disk before the data call uses it', async t => {
  const saves = [];
  let ctx;
  ctx = await setup(t, { wrapVault: v => ({ ...v, save(uid, tokens) { saves.push({ dataSoFar: ctx.fake.count.data, access: tokens.access_token }); v.save(uid, tokens); } }) });
  seed(ctx, 'u1', 0);
  saves.length = 0;
  await ctx.client.get('u1', 'cycle');
  assert.equal(saves.length, 1);
  assert.equal(saves[0].dataSoFar, 0);
  const data = ctx.fake.log.filter(r => r.method === 'GET');
  assert.deepEqual(data.map(r => r.auth), [`Bearer ${saves[0].access}`]);
});

test('a failing save fails the call, the new access token is never used, and the old pair stays', async t => {
  const ctx = await setup(t, { wrapVault: v => ({ ...v, save() { throw new Error('disk full'); } }) });
  const old = seed(ctx, 'u1', 0);
  await assert.rejects(ctx.client.get('u1', 'cycle'), /disk full/);
  assert.equal(ctx.fake.count.refresh_token, 1);
  assert.equal(ctx.fake.count.data, 0);
  assert.deepEqual(ctx.vault.read('u1'), old);
});

// ---- 401 on data -----------------------------------------------------------------------------

test('a 401 on data refreshes once and retries once', async t => {
  const ctx = await setup(t);
  ctx.fake.records.cycle = [{ id: 1 }];
  seed(ctx, 'u1');
  ctx.fake.force('data', 401);
  assert.deepEqual(await ctx.client.get('u1', 'cycle'), [{ id: 1 }]);
  assert.equal(ctx.fake.count.refresh_token, 1);
  assert.equal(ctx.fake.count.data, 2);
});

test('a second 401 throws reconnect', async t => {
  const ctx = await setup(t);
  seed(ctx, 'u1');
  ctx.fake.force('data', 401, 401);
  await rejectsWith(ctx, ctx.client.get('u1', 'cycle'), 'reconnect');
  assert.equal(ctx.fake.count.refresh_token, 1);
  assert.equal(ctx.fake.count.data, 2);
});

test('no tokens at all is reconnect, without calling WHOOP', async t => {
  const ctx = await setup(t);
  await rejectsWith(ctx, ctx.client.get('u1', 'cycle'), 'reconnect');
  assert.equal(ctx.fake.log.length, 0);
});

// ---- refresh failures ------------------------------------------------------------------------

for (const [label, force] of [
  ['400 with another error', 400],
  ['400 without a body', { status: 400, body: '' }],
  ['400 with an unparsable body', { status: 400, body: 'not json' }],
  ['401 with another error', 401],
  ['401 without a body', { status: 401, body: '' }],
  ['401 with an unparsable body', { status: 401, body: 'not json' }],
]) {
  test(`a ${label} on refresh removes the vault entry and throws reconnect`, async t => {
    const ctx = await setup(t);
    seed(ctx, 'u1', 0);
    ctx.fake.force('token', force);
    await rejectsWith(ctx, ctx.client.get('u1', 'cycle'), 'reconnect');
    assert.equal(fs.existsSync(whoopFile(ctx.dir, 'u1')), false);
    assert.equal(ctx.client.connected('u1'), false);
    assert.equal(ctx.fake.count.data, 0);
  });
}

test('a refresh token WHOOP no longer knows is removed too', async t => {
  const ctx = await setup(t);
  ctx.vault.save('u1', { access_token: 'gone-access', refresh_token: 'gone-refresh', expires_at: 0 });
  await rejectsWith(ctx, ctx.client.get('u1', 'cycle'), 'reconnect');
  assert.equal(ctx.vault.read('u1'), null);
});

for (const [force, code] of [[503, 'unavailable'], [500, 'unavailable'], [429, 'rate_limited'], ['drop', 'unreachable']]) {
  test(`a ${force} on refresh throws ${code} and keeps the tokens`, async t => {
    const ctx = await setup(t);
    const old = seed(ctx, 'u1', 0);
    ctx.fake.force('token', force);
    await rejectsWith(ctx, ctx.client.get('u1', 'cycle'), code);
    assert.deepEqual(ctx.vault.read('u1'), old);
  });
}

for (const status of [400, 401]) {
  test(`a ${status} invalid_client on refresh is our misconfiguration: unavailable, tokens kept, and fixing .env recovers`, async t => {
    const ctx = await setup(t, { clientSecret: 'a-rotated-secret-the-env-still-has' });
    ctx.fake.invalidClientStatus = status;
    const old = seed(ctx, 'u1', 0);
    await rejectsWith(ctx, ctx.client.get('u1', 'cycle'), 'unavailable');
    assert.equal(ctx.fake.log.find(r => r.route === 'token').form.grant_type, 'refresh_token');
    assert.deepEqual(ctx.vault.read('u1'), old);
    const fixed = ctx.make();
    assert.deepEqual(await fixed.get('u1', 'cycle'), []);
    assert.equal(ctx.fake.count.refresh_token, 2);
    assert.notEqual(ctx.vault.read('u1').refresh_token, old.refresh_token);
  });
}

test('a refresh that grants fewer scopes is still saved and used: the old refresh token is dead', async t => {
  const ctx = await setup(t);
  const old = seed(ctx, 'u1', 0);
  ctx.fake.override = { scope: 'offline' };
  await ctx.client.get('u1', 'cycle');
  const saved = ctx.vault.read('u1');
  assert.notEqual(saved.refresh_token, old.refresh_token);
  assert.equal(saved.scope, 'offline');
  await ctx.client.get('u1', 'recovery');
  assert.equal(ctx.fake.count.refresh_token, 1);
  const auths = ctx.fake.log.filter(r => r.method === 'GET').map(r => r.auth);
  assert.deepEqual(auths, [`Bearer ${saved.access_token}`, `Bearer ${saved.access_token}`]);
});

test('a refresh response without usable token fields saves nothing', async t => {
  const ctx = await setup(t);
  for (const override of [{ refresh_token: undefined }, { access_token: '' }, { expires_in: 0 }, { token_type: 'mac' }, 'not json']) {
    const old = seed(ctx, 'u1', 0);
    ctx.fake.override = override;
    await rejectsWith(ctx, ctx.client.get('u1', 'cycle'), 'incomplete');
    assert.deepEqual(ctx.vault.read('u1'), old, `changed despite ${JSON.stringify(override)}`);
  }
});

// ---- paging ----------------------------------------------------------------------------------

test('paging follows next_token as nextToken, repeats limit and start, and stops when it is empty', async t => {
  const ctx = await setup(t);
  seed(ctx, 'u1');
  ctx.fake.records['activity/workout'] = Array.from({ length: 60 }, (_, i) => ({ id: i }));
  const records = await ctx.client.get('u1', 'activity/workout', { start: START });
  assert.deepEqual(records.map(r => r.id), Array.from({ length: 60 }, (_, i) => i));
  const queries = ctx.fake.log.filter(r => r.method === 'GET').map(r => new URL(r.url, 'http://x'));
  assert.equal(queries.length, 3);
  for (const q of queries) {
    assert.equal(q.pathname, '/developer/v2/activity/workout');
    assert.equal(q.searchParams.get('limit'), '25');
    assert.equal(q.searchParams.get('start'), START);
  }
  assert.deepEqual(queries.map(q => q.searchParams.get('nextToken')), [null, 'o25', 'o50']);
});

test('an empty-string next_token ends paging, and no start sends no start', async t => {
  const ctx = await setup(t);
  seed(ctx, 'u1');
  ctx.fake.page = () => ({ records: [{ id: 1 }], next_token: '' });
  assert.deepEqual(await ctx.client.get('u1', 'cycle'), [{ id: 1 }]);
  assert.equal(ctx.fake.count.data, 1);
  assert.equal(new URL(ctx.fake.log[0].url, 'http://x').searchParams.has('start'), false);
});

test('paging caps at 20 pages', async t => {
  const ctx = await setup(t);
  seed(ctx, 'u1');
  let n = 0;
  ctx.fake.page = () => ({ records: [{ id: n }], next_token: `t${++n}` });
  await rejectsWith(ctx, ctx.client.get('u1', 'cycle'), 'unavailable');
  assert.equal(ctx.fake.count.data, 20);
});

test('a repeated or non-string next_token throws', async t => {
  const ctx = await setup(t);
  seed(ctx, 'u1');
  ctx.fake.page = () => ({ records: [], next_token: 'again' });
  await rejectsWith(ctx, ctx.client.get('u1', 'cycle'), 'unavailable');
  assert.equal(ctx.fake.count.data, 2);
  ctx.fake.page = () => ({ records: [], next_token: 7 });
  await rejectsWith(ctx, ctx.client.get('u1', 'cycle'), 'unavailable');
  assert.equal(ctx.fake.count.data, 3);
});

test('get reads only the four collections; anything else is a plain Error and no request', async t => {
  const ctx = await setup(t);
  seed(ctx, 'u1');
  for (const bad of ['user/access', 'user/profile/basic', '../oauth/oauth2/token', 'cycle?limit=1', 'activity', '', undefined]) {
    await assert.rejects(ctx.client.get('u1', bad), e => !(e instanceof WhoopError) && /collection/.test(e.message));
  }
  assert.equal(ctx.fake.log.length, 0);
  for (const c of COLLECTIONS) assert.deepEqual(await ctx.client.get('u1', c), []);
});

test('a body without a records array, or not JSON, is unavailable', async t => {
  const ctx = await setup(t);
  seed(ctx, 'u1');
  ctx.fake.page = () => ({ data: [] });
  await rejectsWith(ctx, ctx.client.get('u1', 'cycle'), 'unavailable');
  ctx.fake.page = () => 'not json';
  await rejectsWith(ctx, ctx.client.get('u1', 'cycle'), 'unavailable');
});

// ---- data errors -----------------------------------------------------------------------------

test('a 429 throws rate_limited, without a refresh', async t => {
  const ctx = await setup(t);
  const old = seed(ctx, 'u1');
  ctx.fake.force('data', 429);
  await rejectsWith(ctx, ctx.client.get('u1', 'cycle'), 'rate_limited');
  assert.equal(ctx.fake.count.refresh_token, 0);
  assert.deepEqual(ctx.vault.read('u1'), old);
});

test('a 5xx on data is unavailable and a dropped socket unreachable', async t => {
  const ctx = await setup(t);
  seed(ctx, 'u1');
  ctx.fake.force('data', 502);
  await rejectsWith(ctx, ctx.client.get('u1', 'cycle'), 'unavailable');
  ctx.fake.force('data', 'drop');
  await rejectsWith(ctx, ctx.client.get('u1', 'cycle'), 'unreachable');
});

test('a redirect is never followed', async t => {
  const ctx = await setup(t);
  seed(ctx, 'u1');
  ctx.fake.force('data', 302);
  await rejectsWith(ctx, ctx.client.get('u1', 'cycle'), 'unreachable');
  assert.equal(ctx.fake.count.data, 1);
});

test('a WHOOP that never answers is unreachable once the request signal fires', async t => {
  // The client's own signal is 20 s; this fetch adds a shorter one so the test does not wait.
  const ctx = await setup(t, { fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.any([init.signal, AbortSignal.timeout(150)]) }) });
  seed(ctx, 'u1');
  ctx.fake.force('data', 'hang');
  await rejectsWith(ctx, ctx.client.get('u1', 'cycle'), 'unreachable');
});

test('a response body that stalls or breaks mid-read is unreachable, and the tokens stay', async t => {
  const ctx = await setup(t, { fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.any([init.signal, AbortSignal.timeout(150)]) }) });
  for (const [route, entry, ms] of [
    ['data', { status: 200, body: '{"records":[', hang: true }, 3_600_000],
    ['data', { status: 200, body: '{"records":[', drop: true }, 3_600_000],
    ['token', { status: 200, body: '{"access_token":', hang: true }, 0],      // a refresh
    ['token', { status: 400, body: '{"error":', hang: true }, 0],             // a refusal whose error never arrives
  ]) {
    const old = seed(ctx, 'u1', ms);
    ctx.fake.force(route, entry);
    await rejectsWith(ctx, ctx.client.get('u1', 'cycle'), 'unreachable');
    assert.deepEqual(ctx.vault.read('u1'), old, JSON.stringify(entry));
  }
});

test('every request carries a timeout signal and refuses redirects; no token rides in a URL', async t => {
  const inits = [];
  const ctx = await setup(t, { fetch: (url, init) => { inits.push(init); return fetch(url, init); } });
  await ctx.client.exchange('u1', ctx.fake.issueCode());
  ctx.clock.t += 3600 * 1000;
  await ctx.client.get('u1', 'recovery', { start: START });
  assert.deepEqual(await ctx.client.revoke('u1'), { revoked: true, wasConnected: true });
  assert.equal(inits.length, 4);                          // exchange, refresh, data, revoke
  for (const init of inits) {
    assert.equal(init.redirect, 'error');
    assert.ok(init.signal instanceof AbortSignal);
  }
  for (const r of ctx.fake.log) for (const s of ctx.fake.secrets()) assert.ok(!r.url.includes(s));
});

// ---- revoke ----------------------------------------------------------------------------------

test('revoke asks WHOOP to drop access, then deletes the file', async t => {
  const ctx = await setup(t);
  const pair = seed(ctx, 'u1');
  assert.deepEqual(await ctx.client.revoke('u1'), { revoked: true, wasConnected: true });
  assert.equal(ctx.fake.count.revoke, 1);
  assert.equal(ctx.fake.isLive(pair.access_token), false);
  assert.equal(fs.existsSync(whoopFile(ctx.dir, 'u1')), false);
  assert.equal(ctx.client.connected('u1'), false);
});

for (const force of [503, 429, 'drop']) {
  test(`revoke deletes the file even when WHOOP answers ${force}, and reports it`, async t => {
    const ctx = await setup(t);
    seed(ctx, 'u1');
    ctx.fake.force('revoke', force);
    assert.deepEqual(await ctx.client.revoke('u1'), { revoked: false, wasConnected: true });
    assert.equal(fs.existsSync(whoopFile(ctx.dir, 'u1')), false);
  });
}

test('revoke refreshes once on a 401 and retries', async t => {
  const ctx = await setup(t);
  seed(ctx, 'u1');
  ctx.fake.force('revoke', 401);
  assert.deepEqual(await ctx.client.revoke('u1'), { revoked: true, wasConnected: true });
  assert.equal(ctx.fake.count.refresh_token, 1);
  assert.equal(ctx.fake.count.revoke, 2);
  assert.equal(ctx.vault.read('u1'), null);
});

test('revoke with an expired access token refreshes first', async t => {
  const ctx = await setup(t);
  seed(ctx, 'u1', 0);
  assert.deepEqual(await ctx.client.revoke('u1'), { revoked: true, wasConnected: true });
  assert.equal(ctx.fake.count.refresh_token, 1);
  assert.equal(ctx.fake.count.revoke, 1);
});

test('revoke whose refresh is refused still ends disconnected', async t => {
  const ctx = await setup(t);
  seed(ctx, 'u1', 0);
  ctx.fake.force('token', 400);
  assert.deepEqual(await ctx.client.revoke('u1'), { revoked: false, wasConnected: true });
  assert.equal(ctx.fake.count.revoke, 0);
  assert.equal(ctx.vault.read('u1'), null);
});

test('revoke when not connected calls nobody', async t => {
  const ctx = await setup(t);
  assert.deepEqual(await ctx.client.revoke('u1'), { revoked: false, wasConnected: false });
  assert.equal(ctx.fake.log.length, 0);
});

test('revoke removes a file that will not decrypt, as not connected, without calling WHOOP', async t => {
  const ctx = await setup(t);
  createWhoopVault({ dir: ctx.dir, secret: 'd'.repeat(64) }).save('u1', { access_token: 'a', refresh_token: 'r' });
  assert.equal(ctx.client.connected('u1'), false);
  assert.deepEqual(await ctx.client.revoke('u1'), { revoked: false, wasConnected: false });
  assert.equal(fs.existsSync(whoopFile(ctx.dir, 'u1')), false);
  assert.equal(ctx.fake.log.length, 0);
});

test('a revoke during a refresh waits for it, revokes the rotated pair, and nothing writes it back', async t => {
  const ctx = await setup(t);
  seed(ctx, 'u1', 0);
  const g = gate();
  ctx.fake.force('token', g.entry);
  const read = ctx.client.get('u1', 'cycle');
  await g.reached;
  const revoked = ctx.client.revoke('u1');
  g.release();
  await Promise.allSettled([read]);
  assert.deepEqual(await revoked, { revoked: true, wasConnected: true });
  assert.equal(ctx.fake.count.refresh_token, 1);
  assert.equal(ctx.fake.count.revoke, 1);
  assert.equal(ctx.vault.read('u1'), null);
  assert.equal(fs.existsSync(whoopFile(ctx.dir, 'u1')), false);
});
