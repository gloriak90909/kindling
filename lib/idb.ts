// On-device storage (IndexedDB): PDFs and ink never leave the iPad.

export type DocKind = "worksheet" | "slides";
export type StoredDoc = {
  id: string;
  name: string;
  kind: DocKind;
  data: ArrayBuffer;
  thumb: string;
  pages: number;
  addedAt: number;
};

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("kindling", 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("docs")) db.createObjectStore("docs", { keyPath: "id" });
      if (!db.objectStoreNames.contains("ink")) db.createObjectStore("ink");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const r = fn(db.transaction(store, mode).objectStore(store));
    r.onsuccess = () => resolve(r.result as T);
    r.onerror = () => reject(r.error);
  });
}

export const putDoc = (d: StoredDoc) => run<IDBValidKey>("docs", "readwrite", (s) => s.put(d));
export const listDocs = () => run<StoredDoc[]>("docs", "readonly", (s) => s.getAll());
export const deleteDoc = (id: string) => run<undefined>("docs", "readwrite", (s) => s.delete(id));
export const putInk = (key: string, dataUrl: string) => run<IDBValidKey>("ink", "readwrite", (s) => s.put(dataUrl, key));
export const getInk = (key: string) => run<string | undefined>("ink", "readonly", (s) => s.get(key));
