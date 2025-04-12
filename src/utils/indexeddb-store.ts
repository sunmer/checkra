/**
 * Simple IndexedDB store for FileSystemHandles
 */

const DB_NAME = 'FileSystemHandlesDB';
const STORE_NAME = 'DirectoryHandles';
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function getDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = (event) => {
        console.error('IndexedDB error:', (event.target as IDBRequest).error);
        reject(`IndexedDB error: ${(event.target as IDBRequest).error}`);
      };

      request.onsuccess = (event) => {
        resolve((event.target as IDBRequest).result as IDBDatabase);
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBRequest).result as IDBDatabase;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
    });
  }
  return dbPromise;
}

/**
 * Stores a FileSystemDirectoryHandle in IndexedDB.
 * @param key The key to store the handle under (e.g., 'sourceDirectory').
 * @param handle The FileSystemDirectoryHandle to store.
 */
export async function storeDirectoryHandle(key: string, handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(handle, key);

    request.onsuccess = () => resolve();
    request.onerror = (event) => {
      console.error('Error storing handle:', (event.target as IDBRequest).error);
      reject(`Error storing handle: ${(event.target as IDBRequest).error}`);
    };
  });
}

/**
 * Retrieves a FileSystemDirectoryHandle from IndexedDB.
 * @param key The key the handle was stored under.
 * @returns The stored handle or undefined if not found.
 */
export async function getStoredDirectoryHandle(key: string): Promise<FileSystemDirectoryHandle | undefined> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(key);

    request.onsuccess = (event) => {
      resolve((event.target as IDBRequest).result as FileSystemDirectoryHandle | undefined);
    };
    request.onerror = (event) => {
      console.error('Error retrieving handle:', (event.target as IDBRequest).error);
      // Resolve with undefined rather than rejecting on read error
      resolve(undefined);
    };
  });
}

/**
 * Removes a FileSystemDirectoryHandle from IndexedDB.
 * @param key The key the handle was stored under.
 */
export async function removeStoredDirectoryHandle(key: string): Promise<void> {
    const db = await getDb();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.delete(key);

        request.onsuccess = () => resolve();
        request.onerror = (event) => {
            console.error('Error removing handle:', (event.target as IDBRequest).error);
            reject(`Error removing handle: ${(event.target as IDBRequest).error}`);
        };
    });
}
