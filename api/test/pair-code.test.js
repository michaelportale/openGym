/* `node scripts/pair-code.mjs` mints a short-lived session token from DATA_DIR/secret and trades
   it at POST /api/pair/create for a phone pairing code. Real server.js in a child, real script in
   another; temp DATA_DIR only. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { boundPort } from './helpers.mjs';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = crypto.randomBytes(32).toString('hex');
const now = new Date().toISOString();

async function startServer(t, users, { writeSecret = true } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-paircode-'));
  if (writeSecret) fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ users, creds: [], subs: [], invites: [] }));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost' }
  });
  const h = { dataDir, log: '' };
  child.stdout.on('data', d => h.log += d);
  child.stderr.on('data', d => h.log += d);
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  h.port = await boundPort(child, () => h.log);
  return h;
}

function run(h, args = [], env = {}) {
  const r = spawnSync(process.execPath, ['scripts/pair-code.mjs', ...args], {
    cwd: API, encoding: 'utf8',
    env: { ...process.env, DATA_DIR: h.dataDir, PORT: String(h.port), ...env }
  });
  return { code: r.status, out: r.stdout, err: r.stderr, all: r.stdout + r.stderr };
}
const redeem = (h, code) => fetch(`http://127.0.0.1:${h.port}/api/pair/redeem`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code })
});

test('one profile: prints a code the server redeems, and no secret or token', async t => {
  const h = await startServer(t, [{ id: 'u_a', name: 'Ann', created: now }]);
  const r = run(h);
  assert.equal(r.code, 0, r.all);
  const m = /^Pairing code: ([A-Z0-9]+)$/m.exec(r.out);
  assert.ok(m, r.out);
  assert.match(r.out, /Enter it on the phone within 5 minutes\./);
  assert.equal(r.all.includes(SECRET), false);
  assert.doesNotMatch(r.all, /u_a:\d+:\d+:c/);
  const res = await redeem(h, m[1]);
  assert.equal(res.status, 200);
  assert.match((await res.json()).token.split('.')[0], /^u_a:\d+:0:b$/);
});

test('two profiles without --user: exit 1, names listed, ids not', async t => {
  const h = await startServer(t, [{ id: 'u_a', name: 'Ann', created: now }, { id: 'u_b', name: 'Bob', created: now }]);
  const r = run(h);
  assert.equal(r.code, 1);
  assert.match(r.err, /Ann/);
  assert.match(r.err, /Bob/);
  assert.equal(r.all.includes('u_a'), false);
  assert.equal(r.all.includes('u_b'), false);
  assert.equal(r.out, '');
});

test('--user matches by name, and by id first', async t => {
  const h = await startServer(t, [
    { id: 'u_a', name: 'Ann', created: now }, { id: 'u_b', name: 'u_a', created: now }
  ]);
  const byName = run(h, ['--user', 'Ann']);
  assert.equal(byName.code, 0, byName.all);
  const code = /Pairing code: (\S+)/.exec(byName.out)[1];
  assert.match((await (await redeem(h, code)).json()).token, /^u_a:/);
  // 'u_a' is both Ann's id and Bob's name: the id wins
  const byId = run(h, ['--user', 'u_a']);
  assert.equal(byId.code, 0, byId.all);
  const code2 = /Pairing code: (\S+)/.exec(byId.out)[1];
  assert.match((await (await redeem(h, code2)).json()).token, /^u_a:/);
  const none = run(h, ['--user', 'Nobody']);
  assert.equal(none.code, 1);
});

test('disabled profile: exit 1', async t => {
  const h = await startServer(t, [{ id: 'u_a', name: 'Ann', created: now, disabled: true }]);
  const r = run(h);
  assert.equal(r.code, 1);
  assert.match(r.err, /disabled/i);
  assert.equal(r.out, '');
});

test('session version is carried into the token', async t => {
  const h = await startServer(t, [{ id: 'u_a', name: 'Ann', created: now, sv: 3 }]);
  const r = run(h);
  assert.equal(r.code, 0, r.all);
  const code = /Pairing code: (\S+)/.exec(r.out)[1];
  assert.match((await (await redeem(h, code)).json()).token.split('.')[0], /^u_a:\d+:3:b$/);
});

test('wrong PORT: exit 1, not reachable', async t => {
  const h = await startServer(t, [{ id: 'u_a', name: 'Ann', created: now }]);
  const r = run(h, [], { PORT: '1' });
  assert.equal(r.code, 1);
  assert.match(r.err, /not reachable/i);
  assert.equal(r.all.includes(SECRET), false);
});

test('no secret or no profile: exit 1', async t => {
  const noSecret = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-paircode-'));
  t.after(() => fs.rmSync(noSecret, { recursive: true, force: true }));
  const r1 = spawnSync(process.execPath, ['scripts/pair-code.mjs'], { cwd: API, encoding: 'utf8', env: { ...process.env, DATA_DIR: noSecret } });
  assert.equal(r1.status, 1);
  assert.match(r1.stderr, /secret/i);
  const h = await startServer(t, []);
  const r2 = run(h);
  assert.equal(r2.code, 1);
  assert.match(r2.err, /no profile/i);
});

test('server refuses (secret differs from the running server\'s): exit 1, nothing leaked', async t => {
  const h = await startServer(t, [{ id: 'u_a', name: 'Ann', created: now }]);
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-paircode-'));
  t.after(() => fs.rmSync(other, { recursive: true, force: true }));
  const wrong = 'b'.repeat(64);
  fs.writeFileSync(path.join(other, 'secret'), wrong);
  fs.copyFileSync(path.join(h.dataDir, 'db.json'), path.join(other, 'db.json'));
  const r = run(h, [], { DATA_DIR: other });
  assert.equal(r.code, 1);
  assert.match(r.err, /refused/i);
  assert.equal(r.all.includes(wrong), false);
  assert.equal(r.all.includes(SECRET), false);
});
