const DB_NAME = 'YtAlgoRebelDB';
const DB_VERSION = 1;

export const initDB = () => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = (event) => {
      console.error('Database error: ' + event.target.errorCode);
      reject(event.target.error);
    };

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      if (!db.objectStoreNames.contains('videoHistory')) {
        db.createObjectStore('videoHistory', { keyPath: 'videoId' });
      }

      if (!db.objectStoreNames.contains('tasteMatrix')) {
        db.createObjectStore('tasteMatrix', { keyPath: 'id' });
      }
    };

    request.onsuccess = (event) => {
      resolve(event.target.result);
    };
  });
};

export const getDB = async () => {
  return await initDB();
};

export const getStore = async (storeName, mode = 'readonly') => {
  const db = await getDB();
  const tx = db.transaction(storeName, mode);
  return tx.objectStore(storeName);
};

export const putItem = async (storeName, item) => {
  const store = await getStore(storeName, 'readwrite');
  return new Promise((resolve, reject) => {
    const request = store.put(item);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

export const getItem = async (storeName, key) => {
  const store = await getStore(storeName, 'readonly');
  return new Promise((resolve, reject) => {
    const request = store.get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

export const getAllItems = async (storeName) => {
  const store = await getStore(storeName, 'readonly');
  return new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

export const deleteItem = async (storeName, key) => {
  const store = await getStore(storeName, 'readwrite');
  return new Promise((resolve, reject) => {
    const request = store.delete(key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};
