/* The WHOOP token vault (Phase 8).
 *
 * The owner's WHOOP access and refresh tokens are the one credential in DATA_DIR that opens a
 * third-party account, so they are not kept in db.json or state-<uid>.json, where a backup or a
 * support copy of the state would carry them along. Each user gets a file of their own,
 * DATA_DIR/whoop-<uid>.json, written 0600 and encrypted with AES-256-GCM under a key derived
 * (HKDF-SHA256) from DATA_DIR/secret. A copy of the file without that secret is useless, and a
 * file that will not decrypt — wrong secret, tampering, truncation — reads as "not connected"
 * rather than an error: the owner just connects again.
 *
 * File: { v: 1, iv, tag, data }, each base64url. The uid goes into the file name, so it is
 * checked against the shape server.js gives ids (base64url) and nothing with a path separator or
 * a dot gets through. Pure storage: the OAuth flow and the refresh are someone else's. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { atomicWrite } from './durable.js';

const UID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const INFO = 'opengym whoop tokens v1';

function checkUid(uid) {
  if (typeof uid !== 'string' || !UID_RE.test(uid)) throw new Error('invalid uid');
  return uid;
}

export function whoopFile(dir, uid) {
  return path.join(dir, `whoop-${checkUid(uid)}.json`);
}

const b64 = buf => Buffer.from(buf).toString('base64url');
const unb64 = s => {
  if (typeof s !== 'string') throw new Error('bad field');
  return Buffer.from(s, 'base64url');
};

export function createWhoopVault({ dir, secret, write = atomicWrite }) {
  // 32 bytes for AES-256. The secret is already random, so no salt is needed.
  const key = Buffer.from(crypto.hkdfSync('sha256', String(secret), Buffer.alloc(0), INFO, 32));

  function read(uid) {
    const file = whoopFile(dir, uid);
    try {
      const f = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!f || f.v !== 1) return null;
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, unb64(f.iv));
      decipher.setAuthTag(unb64(f.tag));
      const plain = Buffer.concat([decipher.update(unb64(f.data)), decipher.final()]).toString('utf8');
      const t = JSON.parse(plain);
      if (typeof t?.access_token !== 'string' || typeof t.refresh_token !== 'string') return null;
      return { access_token: t.access_token, refresh_token: t.refresh_token, expires_at: t.expires_at, scope: t.scope };
    } catch { return null; }
  }

  function save(uid, tokens) {
    const file = whoopFile(dir, uid);
    if (!tokens || typeof tokens.access_token !== 'string' || typeof tokens.refresh_token !== 'string') {
      throw new Error('tokens need access_token and refresh_token');
    }
    const { access_token, refresh_token, expires_at, scope } = tokens;
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const data = Buffer.concat([cipher.update(JSON.stringify({ access_token, refresh_token, expires_at, scope }), 'utf8'), cipher.final()]);
    write(file, JSON.stringify({ v: 1, iv: b64(iv), tag: b64(cipher.getAuthTag()), data: b64(data) }), 0o600);
  }

  function remove(uid) {
    const file = whoopFile(dir, uid);
    try { fs.unlinkSync(file); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }

  return { read, save, remove };
}
