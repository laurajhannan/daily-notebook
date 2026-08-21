/* backup.js — save everything to a file, and put it back again.
 *
 * File shape:
 *   { app: "daily-notebook", version: 1, exportedAt, encrypted: false, data: {...} }
 *   { app: "daily-notebook", version: 1, exportedAt, encrypted: true, salt, iv, data: "<base64 ciphertext>" }
 *
 * Encryption (only when a passphrase is given):
 *   PBKDF2-SHA-256, 210,000 iterations, random 16-byte salt  →  AES-GCM 256, random 12-byte IV.
 * There is no recovery path: forget the passphrase and the file is simply gone.
 */

import * as db from './db.js';
import * as S from './stats.js';

const APP_TAG = 'daily-notebook';
const FORMAT_VERSION = 1;
const PBKDF2_ITERATIONS = 210000;

/* ---------- base64 helpers ---------- */

function bytesToBase64(bytes) {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function base64ToBytes(b64) {
  const bin = atob(String(b64 || ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/* ---------- crypto ---------- */

function subtle() {
  if (!globalThis.crypto || !globalThis.crypto.subtle) {
    throw new Error('This browser cannot encrypt backups here. Save without a passphrase, or use a secure connection.');
  }
  return globalThis.crypto.subtle;
}

async function deriveKey(passphrase, salt) {
  const material = await subtle().importKey(
    'raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']
  );
  return subtle().deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/* ---------- export ---------- */

/** Build the backup object. `passphrase` empty or null means an unencrypted file. */
export async function buildBackup(passphrase) {
  const data = await db.exportAll();
  const envelope = {
    app: APP_TAG,
    version: FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    encrypted: false,
    data
  };

  if (!passphrase) return envelope;

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
  const plaintext = new TextEncoder().encode(JSON.stringify(data));
  const cipher = await subtle().encrypt({ name: 'AES-GCM', iv }, key, plaintext);

  return {
    app: APP_TAG,
    version: FORMAT_VERSION,
    exportedAt: envelope.exportedAt,
    encrypted: true,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: PBKDF2_ITERATIONS },
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    data: bytesToBase64(new Uint8Array(cipher))
  };
}

export function backupFilename(date = new Date()) {
  return `daily-notebook-backup-${S.toISODate(date)}.json`;
}

/** Build the backup and hand the browser a file to save. Records the backup date. */
export async function downloadBackup(passphrase) {
  const envelope = await buildBackup(passphrase);
  const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = backupFilename();
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the download a moment to start before releasing the object URL.
  setTimeout(() => URL.revokeObjectURL(url), 4000);

  await db.setSetting('lastBackup', S.toISODate());
  return envelope.encrypted;
}

/* ---------- import ---------- */

/** Throws with a readable message if this isn't a Daily Notebook backup. */
export function validateEnvelope(obj) {
  if (!obj || typeof obj !== 'object') throw new Error('That file isn\'t a Daily Notebook backup.');
  if (obj.app !== APP_TAG) throw new Error('That file isn\'t a Daily Notebook backup.');
  if (typeof obj.version !== 'number') throw new Error('That backup is missing its version.');
  if (obj.version > FORMAT_VERSION) throw new Error('That backup was made by a newer version of the app.');
  if (obj.encrypted) {
    if (typeof obj.data !== 'string' || !obj.salt || !obj.iv) throw new Error('That encrypted backup looks incomplete.');
  } else if (!obj.data || typeof obj.data !== 'object') {
    throw new Error('That backup has no data in it.');
  }
  return true;
}

/** Basic shape check on the decrypted payload. */
export function validateData(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('That backup\'s contents look wrong.');
  const known = Object.keys(db.STORES);
  const present = known.filter((k) => Array.isArray(data[k]));
  if (!present.length) throw new Error('That backup doesn\'t contain any notebook records.');
  return present;
}

/** Read a File, decrypt if needed, validate. Does NOT write anything. */
export async function readBackupFile(file, passphrase) {
  const text = await file.text();
  let obj;
  try {
    obj = JSON.parse(text);
  } catch (_) {
    throw new Error('That file isn\'t readable as a backup.');
  }
  validateEnvelope(obj);

  let data = obj.data;
  if (obj.encrypted) {
    if (!passphrase) throw new Error('That backup is protected. Enter its passphrase and try again.');
    const salt = base64ToBytes(obj.salt);
    const iv = base64ToBytes(obj.iv);
    const key = await deriveKey(passphrase, salt);
    let plain;
    try {
      plain = await subtle().decrypt({ name: 'AES-GCM', iv }, key, base64ToBytes(obj.data));
    } catch (_) {
      throw new Error('That passphrase didn\'t open the backup.');
    }
    try {
      data = JSON.parse(new TextDecoder().decode(plain));
    } catch (_) {
      throw new Error('The backup opened but its contents were unreadable.');
    }
  }

  validateData(data);
  return { envelope: obj, data };
}

/** Replace the notebook's contents with a backup's. Destructive — confirm first. */
export async function restoreBackup(data) {
  await db.replaceAll(data);
}
