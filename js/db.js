/* db.js — a small promise wrapper around IndexedDB.
 *
 * Database: "daily-notebook", version 1.
 * Stores:
 *   entries    keyPath "date"  — one record per calendar day (YYYY-MM-DD)
 *   bp         keyPath "ts"    — one record per blood-pressure reading (ms timestamp)
 *   milestones keyPath "id"    autoIncrement
 *   questions  keyPath "id"    autoIncrement
 *   settings   keyPath "key"   — { key, value }
 *
 * Migration note: onupgradeneeded runs createStores() which only creates what is
 * missing, so a future version 2 adds its own `if (oldVersion < 2) { ... }` block
 * below and nothing else has to change.
 */

export const DB_NAME = 'daily-notebook';
export const DB_VERSION = 1;

export const STORES = {
  entries: { keyPath: 'date' },
  bp: { keyPath: 'ts' },
  milestones: { keyPath: 'id', autoIncrement: true },
  questions: { keyPath: 'id', autoIncrement: true },
  settings: { keyPath: 'key' }
};

let dbPromise = null;

/** Open (and if needed create/upgrade) the database. Cached after first call. */
export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    let req;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (err) {
      reject(err);
      return;
    }
    req.onupgradeneeded = (event) => {
      const db = req.result;
      const oldVersion = event.oldVersion || 0;

      if (oldVersion < 1) {
        for (const [name, opts] of Object.entries(STORES)) {
          if (!db.objectStoreNames.contains(name)) {
            db.createObjectStore(name, opts);
          }
        }
      }
      // Future: if (oldVersion < 2) { ...add stores / indexes here... }
    };
    req.onsuccess = () => {
      const db = req.result;
      // If another tab opens a newer version, close so it isn't blocked.
      db.onversionchange = () => { try { db.close(); } catch (_) {} dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Database upgrade blocked by another open tab.'));
  });
  return dbPromise;
}

/** Run `fn(store)` inside a transaction and resolve with the request's result. */
function withStore(storeName, mode, fn) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    let tx;
    try {
      tx = db.transaction(storeName, mode);
    } catch (err) {
      reject(err);
      return;
    }
    const store = tx.objectStore(storeName);
    let result;
    try {
      const req = fn(store);
      if (req && typeof req === 'object' && 'onsuccess' in req) {
        req.onsuccess = () => { result = req.result; };
        req.onerror = () => reject(req.error);
      }
    } catch (err) {
      reject(err);
      return;
    }
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
  }));
}

/** Get one record by key. Resolves undefined when absent. */
export function get(storeName, key) {
  return withStore(storeName, 'readonly', (s) => s.get(key));
}

/** Get every record in a store, in key order. */
export function getAll(storeName) {
  return withStore(storeName, 'readonly', (s) => s.getAll());
}

/** Insert or replace a record. Resolves with the key. */
export function put(storeName, value) {
  return withStore(storeName, 'readwrite', (s) => s.put(value));
}

/** Insert or replace many records in one transaction. */
export function putAll(storeName, values) {
  return withStore(storeName, 'readwrite', (s) => {
    for (const v of values || []) s.put(v);
    return null;
  });
}

/** Delete one record by key. */
export function del(storeName, key) {
  return withStore(storeName, 'readwrite', (s) => s.delete(key));
}

/** Empty a store. */
export function clear(storeName) {
  return withStore(storeName, 'readwrite', (s) => s.clear());
}

/** Count records in a store. */
export function count(storeName) {
  return withStore(storeName, 'readonly', (s) => s.count());
}

/* ---------- settings helpers ---------- */

/** Read a setting's value, or `fallback` when it has never been written. */
export async function getSetting(key, fallback = null) {
  const rec = await get('settings', key);
  return rec && 'value' in rec ? rec.value : fallback;
}

/** Write a setting's value. */
export function setSetting(key, value) {
  return put('settings', { key, value });
}

/** Read every setting as a plain object. */
export async function getSettingsObject() {
  const all = await getAll('settings');
  const out = {};
  for (const rec of all || []) {
    if (rec && typeof rec.key === 'string') out[rec.key] = rec.value;
  }
  return out;
}

/* ---------- whole-database import/export ---------- */

/** Snapshot every store as { storeName: [records] }. */
export async function exportAll() {
  const out = {};
  for (const name of Object.keys(STORES)) {
    out[name] = await getAll(name);
  }
  return out;
}

/**
 * Replace the contents of every store present in `data`.
 * Stores missing from `data` are left untouched, so a partial backup
 * from a future version still restores what it does contain.
 */
export async function replaceAll(data) {
  for (const name of Object.keys(STORES)) {
    if (!Object.prototype.hasOwnProperty.call(data, name)) continue;
    const records = Array.isArray(data[name]) ? data[name] : [];
    await clear(name);
    if (records.length) await putAll(name, records);
  }
}
