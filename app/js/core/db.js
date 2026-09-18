/**
 * A small promise wrapper over IndexedDB.
 *
 * IndexedDB rather than localStorage because the review log grows without
 * bound, decks can outgrow the ~5 MB quota, and writes must not block the UI
 * thread in the middle of a review.
 */

export const DB_NAME = "funky";
export const DB_VERSION = 1;

export const STORE_DECKS = "decks";
export const STORE_NOTES = "notes";
export const STORE_CARDS = "cards";
export const STORE_REVLOG = "revlog";
export const STORE_META = "meta";

const ALL_STORES = [STORE_DECKS, STORE_NOTES, STORE_CARDS, STORE_REVLOG, STORE_META];

let dbPromise = null;

const wrap = (request) =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

export function openDb() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = request.result;

      if (event.oldVersion < 1) {
        db.createObjectStore(STORE_DECKS, { keyPath: "id" });

        const notes = db.createObjectStore(STORE_NOTES, { keyPath: "id" });
        notes.createIndex("deckId", "deckId");
        notes.createIndex("modified", "modified");

        const cards = db.createObjectStore(STORE_CARDS, { keyPath: "id" });
        cards.createIndex("deckId", "deckId");
        cards.createIndex("noteId", "noteId");
        cards.createIndex("due", "due");

        const revlog = db.createObjectStore(STORE_REVLOG, {
          keyPath: "id",
          autoIncrement: true,
        });
        revlog.createIndex("cardId", "cardId");
        revlog.createIndex("reviewedAt", "reviewedAt");

        db.createObjectStore(STORE_META, { keyPath: "key" });
      }
      // Later schema versions add their migrations here, guarded the same way.
    };

    request.onsuccess = () => {
      const db = request.result;
      // A second tab running a newer version must not be blocked by this one.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(new Error("Another tab is holding an older version of the database open."));
  });

  return dbPromise;
}

/**
 * Run `fn` inside one transaction over `stores`, resolving when the
 * transaction commits (not merely when `fn` returns) so callers can rely on
 * the data being durable.
 */
export async function tx(stores, mode, fn) {
  const db = await openDb();
  const names = Array.isArray(stores) ? stores : [stores];
  const transaction = db.transaction(names, mode);
  const handles = Object.fromEntries(names.map((n) => [n, transaction.objectStore(n)]));

  const done = new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error("Transaction aborted"));
  });

  const result = await fn(names.length === 1 ? handles[names[0]] : handles, transaction);
  await done;
  return result;
}

export const get = (store, key) => tx(store, "readonly", (s) => wrap(s.get(key)));

export const getAll = (store) => tx(store, "readonly", (s) => wrap(s.getAll()));

export const getAllByIndex = (store, index, value) =>
  tx(store, "readonly", (s) => wrap(s.index(index).getAll(value)));

export const put = (store, value) => tx(store, "readwrite", (s) => wrap(s.put(value)));

export const putAll = (store, values) =>
  tx(store, "readwrite", (s) => Promise.all(values.map((v) => wrap(s.put(v)))));

/** Insert rows into an auto-incrementing store; callers must not set the key. */
export const addAll = (store, values) =>
  tx(store, "readwrite", (s) => Promise.all(values.map((v) => wrap(s.add(v)))));

export const remove = (store, key) => tx(store, "readwrite", (s) => wrap(s.delete(key)));

export const removeAll = (store, keys) =>
  tx(store, "readwrite", (s) => Promise.all(keys.map((k) => wrap(s.delete(k)))));

export const count = (store) => tx(store, "readonly", (s) => wrap(s.count()));

/** meta is a plain key/value store; these two hide the wrapper record. */
export async function getMeta(key, fallback = null) {
  const row = await get(STORE_META, key);
  return row === undefined ? fallback : row.value;
}

export const setMeta = (key, value) => put(STORE_META, { key, value });

/** Wipe everything — used by the "reset app" action in settings. */
export async function clearAll() {
  await tx(ALL_STORES, "readwrite", (stores) =>
    Promise.all(ALL_STORES.map((name) => wrap(stores[name].clear())))
  );
}

/** How much of the storage quota we are using, when the browser will say. */
export async function storageEstimate() {
  if (!navigator.storage?.estimate) return null;
  try {
    return await navigator.storage.estimate();
  } catch {
    return null;
  }
}
