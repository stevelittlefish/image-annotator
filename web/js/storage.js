// Browser-local persistence. The working image and its annotations autosave to
// IndexedDB (image blobs blow through localStorage's ~5 MB quota); small tool
// settings live in localStorage.

const DB_NAME = 'image-annotator';
const STORE = 'session';
const KEY = 'current';
const SETTINGS_KEY = 'image-annotator.settings';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await openDB();
  try {
    return await new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(req?.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  } finally {
    db.close();
  }
}

/** Save { image: Blob, shapes } as the current session. */
export function saveSession(session) {
  return tx('readwrite', (s) => s.put(session, KEY));
}

/** Load the current session, or undefined. */
export function loadSession() {
  return tx('readonly', (s) => s.get(KEY));
}

export function clearSession() {
  return tx('readwrite', (s) => s.delete(KEY));
}

export function loadSettings(defaults) {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') };
  } catch {
    return { ...defaults };
  }
}

export function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
