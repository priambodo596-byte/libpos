const DB_NAME = "convetlib-playground-session";
const DB_VERSION = 1;
const STORE = "sessions";
const SESSION_KEY = "active-preview";
function openDB() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) return reject(new Error("IndexedDB tidak tersedia di browser ini"));
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Gagal membuka database sesi"));
  });
}
async function withStore(mode, operation) {
  const db = await openDB();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const result = operation(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(result?.result);
      tx.onerror = () => reject(tx.error || new Error("Transaksi penyimpanan sesi gagal"));
      tx.onabort = () => reject(tx.error || new Error("Transaksi penyimpanan sesi dibatalkan"));
    });
  } finally { db.close(); }
}
export async function savePreviewSession(document, ui = {}) {
  const record = { key: SESSION_KEY, version: 1, savedAt: new Date().toISOString(), document: structuredClone(document), ui: structuredClone(ui) };
  await withStore("readwrite", store => store.put(record));
  return record.savedAt;
}
export async function loadPreviewSession() {
  const db = await openDB();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE, "readonly").objectStore(STORE).get(SESSION_KEY);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error || new Error("Gagal membaca sesi"));
    });
  } finally { db.close(); }
}
export async function clearPreviewSession() {
  await withStore("readwrite", store => store.delete(SESSION_KEY));
}
