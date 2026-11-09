#!/usr/bin/env node
/* Print a phone pairing code from the machine that runs the server.
 *
 *   node scripts/pair-code.mjs [--user <id|name>]
 *   docker compose exec api node scripts/pair-code.mjs [--user <id|name>]
 *
 * Does what Settings -> "Pair the mobile app" does, without a browser: reads DATA_DIR/secret and
 * db.json, signs a session token for the profile (the same `uid:exp:sv:kind` payload server.js
 * makeSession() builds, here cookie-kind and good for 60 seconds so it is never renewed and is
 * useless a minute later), and trades it at POST /api/pair/create. Only the code is printed --
 * never the secret or the token, error paths included. Needs the server running on PORT.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = process.env.DATA_DIR || './data';
const PORT = process.env.PORT || '3000';

const fail = msg => { console.error('pair-code: ' + msg); process.exit(1); };

const argv = process.argv.slice(2);
let want = null;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--user') want = argv[++i];
  else if (argv[i].startsWith('--user=')) want = argv[i].slice(7);
  else fail(`unknown argument "${argv[i]}" (usage: pair-code.mjs [--user <id|name>])`);
}
if (want === undefined || want === '') fail('--user needs a profile id or name');

let secret;
try { secret = fs.readFileSync(path.join(DATA_DIR, 'secret'), 'utf8').trim(); } catch { secret = ''; }
if (!secret) fail(`no secret in ${DATA_DIR} (is DATA_DIR the server's data folder?)`);

let users;
try { users = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'db.json'), 'utf8')).users; } catch { users = null; }
if (!Array.isArray(users) || !users.length) fail(`no profile in ${DATA_DIR}/db.json`);

let user;
if (want !== null) {
  user = users.find(u => u.id === want) || users.find(u => u.name === want);
  if (!user) fail(`no profile "${want}". Profiles: ${users.map(u => u.name).join(', ')}`);
} else if (users.length === 1) {
  user = users[0];
} else {
  fail(`more than one profile; pass --user <name>. Profiles: ${users.map(u => u.name).join(', ')}`);
}
if (user.disabled) fail(`profile "${user.name}" is disabled`);

const payload = user.id + ':' + (Date.now() + 60000) + ':' + (user.sv || 0) + ':c';
const token = payload + '.' + crypto.createHmac('sha256', secret).update(payload).digest('base64url');

let res;
try {
  res = await fetch(`http://127.0.0.1:${PORT}/api/pair/create`, {
    method: 'POST', headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(10000)
  });
} catch {
  fail(`server not reachable on port ${PORT} (is it running? set PORT if it is not ${PORT})`);
}
if (!res.ok) fail(`server refused (HTTP ${res.status}); is DATA_DIR the folder this server uses?`);
let code;
try { code = (await res.json()).code; } catch { code = null; }
if (!code) fail('server answered without a code');

console.log('Pairing code: ' + code);
console.log('Enter it on the phone within 5 minutes.');
