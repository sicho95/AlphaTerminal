/** Move SW Web Push alerts into the existing localStorage alert history. */
import { addAlert, state } from './store.js';

export async function syncPendingPushAlerts() {
  if (!('indexedDB' in globalThis)) return 0;
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('AlphaTerminalPushV1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('pending', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    const pending = await new Promise((resolve, reject) => {
      const tx = db.transaction('pending', 'readonly');
      const request = tx.objectStore('pending').getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
    let added = 0;
    for (const alert of pending) {
      if (!state.alerts.some(item => item.id === alert.id)) {
        addAlert(alert); // Existing history key alphaTerm_alerts is preserved.
        added += 1;
      }
      await new Promise((resolve, reject) => {
        const tx = db.transaction('pending', 'readwrite');
        tx.objectStore('pending').delete(alert.id);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    }
    return added;
  } finally { db.close(); }
}
