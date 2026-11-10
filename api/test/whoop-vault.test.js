/* The WHOOP token vault: tokens are encrypted at rest, per user, and a file that will not
 * decrypt reads as "not connected" instead of throwing. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createWhoopVault, whoopFile } from '../whoop-vault.js';

const SECRET = 'a'.repeat(64);
const tokens = { access_token: 'ACCESS-TOKEN-xyz-123', refresh_token: 'REFRESH-TOKEN-abc-789', expires_at: 1790000000000, scope: 'read:recovery offline' };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'whoop-vault-'));

test('round trip keeps the fields', () => {
  const dir = tmp();
  const v = createWhoopVault({ dir, secret: SECRET });
  v.save('user1', tokens);
  assert.deepEqual(v.read('user1'), tokens);
});

test('the file holds neither token and is mode 0600', () => {
  const dir = tmp();
  createWhoopVault({ dir, secret: SECRET }).save('user1', tokens);
  const file = whoopFile(dir, 'user1');
  assert.equal(path.basename(file), 'whoop-user1.json');
  const text = fs.readFileSync(file, 'utf8');
  assert.ok(!text.includes(tokens.access_token));
  assert.ok(!text.includes(tokens.refresh_token));
  assert.equal(JSON.parse(text).v, 1);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

test('a different secret reads as null and never throws', () => {
  const dir = tmp();
  createWhoopVault({ dir, secret: SECRET }).save('user1', tokens);
  assert.equal(createWhoopVault({ dir, secret: 'b'.repeat(64) }).read('user1'), null);
});

test('a corrupt or malformed file reads as null', () => {
  const dir = tmp();
  const v = createWhoopVault({ dir, secret: SECRET });
  fs.writeFileSync(whoopFile(dir, 'user1'), 'not json');
  assert.equal(v.read('user1'), null);
  fs.writeFileSync(whoopFile(dir, 'user1'), JSON.stringify({ v: 1, iv: 'x', tag: 'y', data: 'z' }));
  assert.equal(v.read('user1'), null);
  fs.writeFileSync(whoopFile(dir, 'user1'), JSON.stringify({ v: 2 }));
  assert.equal(v.read('user1'), null);
  v.save('user1', tokens);
  const f = JSON.parse(fs.readFileSync(whoopFile(dir, 'user1'), 'utf8'));
  f.data = Buffer.from('tampered').toString('base64url');
  fs.writeFileSync(whoopFile(dir, 'user1'), JSON.stringify(f));
  assert.equal(v.read('user1'), null);
});

test('a missing file reads as null and remove of it is fine', () => {
  const v = createWhoopVault({ dir: tmp(), secret: SECRET });
  assert.equal(v.read('nobody'), null);
  assert.doesNotThrow(() => v.remove('nobody'));
});

test('remove deletes the file', () => {
  const dir = tmp();
  const v = createWhoopVault({ dir, secret: SECRET });
  v.save('user1', tokens);
  v.remove('user1');
  assert.equal(fs.existsSync(whoopFile(dir, 'user1')), false);
  assert.equal(v.read('user1'), null);
});

test('two users are independent', () => {
  const v = createWhoopVault({ dir: tmp(), secret: SECRET });
  v.save('a', tokens);
  v.save('b', { ...tokens, access_token: 'other' });
  assert.equal(v.read('a').access_token, tokens.access_token);
  assert.equal(v.read('b').access_token, 'other');
  v.remove('a');
  assert.equal(v.read('b').access_token, 'other');
});

test('a uid with path characters is refused', () => {
  const dir = tmp();
  const v = createWhoopVault({ dir, secret: SECRET });
  for (const bad of ['../x', 'a/b', '..', '', 'a.b', 'a\\b', null, undefined, 5, 'x'.repeat(65)]) {
    assert.throws(() => whoopFile(dir, bad), /uid/);
    assert.throws(() => v.save(bad, tokens), /uid/);
    assert.throws(() => v.read(bad), /uid/);
    assert.throws(() => v.remove(bad), /uid/);
  }
});

test('the injected write is used with mode 0600', () => {
  const calls = [];
  const v = createWhoopVault({ dir: tmp(), secret: SECRET, write: (f, c, m) => calls.push([f, c, m]) });
  v.save('user1', tokens);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][2], 0o600);
});

test('a save refuses tokens without the fields', () => {
  const v = createWhoopVault({ dir: tmp(), secret: SECRET });
  assert.throws(() => v.save('user1', { access_token: 'x' }), /tokens/);
  assert.throws(() => v.save('user1', null), /tokens/);
});
