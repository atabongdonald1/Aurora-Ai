import { openDB, IDBPDatabase } from 'idb';

const DB_NAME = 'AuroraStudioCache';
const STORE_NAME = 'assets';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase> | null = null;

const getDB = () => {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      },
    });
  }
  return dbPromise;
};

export const storageService = {
  async saveAsset(id: string, blob: Blob): Promise<void> {
    const db = await getDB();
    await db.put(STORE_NAME, blob, id);
  },

  async getAsset(id: string): Promise<Blob | null> {
    const db = await getDB();
    const asset = await db.get(STORE_NAME, id);
    return asset || null;
  },

  async deleteAsset(id: string): Promise<void> {
    const db = await getDB();
    await db.delete(STORE_NAME, id);
  },

  async clearAll(): Promise<void> {
    const db = await getDB();
    await db.clear(STORE_NAME);
  }
};
