import { addAlert, getSettings, saveSettings } from './store.js';

/** Internal history is always available; system notifications require a user gesture. */
export const NotifService = {
  init() { /* No permission prompt during launch: iOS requires an explicit gesture. */ },

  async enable() {
    if (!('Notification' in globalThis)) return false;
    try {
      const permission = Notification.permission === 'granted'
        ? 'granted' : await Notification.requestPermission();
      const enabled = permission === 'granted';
      saveSettings({ notificationsEnabled: enabled });
      return enabled;
    } catch { return false; }
  },

  push(title, message, severity = 'info', options = {}) {
    const alert = addAlert({ title, message, severity, ...options });
    if (getSettings().notificationsEnabled && 'Notification' in globalThis && Notification.permission === 'granted') {
      // iOS home-screen web apps support the SW notification API, not new Notification().
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistration().then(reg => {
          if (reg?.showNotification) return reg.showNotification(title, {
            body: message, icon: './icons/icon-192.png', tag: alert.id,
            data: { alertId: alert.id }
          });
        }).catch(error => console.warn('Notification system unavailable', error));
      }
    }
    return alert;
  },

  sendPush(title, body) { return this.push(title, body, 'info'); },
  sendError(title, body) { return this.push(title, body, 'error'); }
};
