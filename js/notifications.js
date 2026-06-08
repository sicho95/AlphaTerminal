import { addAlert, getSettings, saveSettings } from './store.js';

export const NotifService = {
  init() {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default' && getSettings().notificationsEnabled) {
      Notification.requestPermission().catch(() => {});
    }
  },

  async enable() {
    if (!('Notification' in window)) return false;
    const permission = await Notification.requestPermission();
    const enabled = permission === 'granted';
    saveSettings({ notificationsEnabled: enabled });
    return enabled;
  },

  push(title, message, severity = 'info') {
    const alert = addAlert({ title, message, severity });
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body: message, icon: './icons/icon-192.png' });
    }
    return alert;
  },

  sendPush(title, body) {
    return this.push(title, body, 'info');
  },

  sendError(title, body) {
    return this.push(title, body, 'error');
  }
};
