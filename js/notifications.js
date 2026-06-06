/**
 * AlphaTerminal Notifications
 */
import { Store } from './store.js';

export const NotifService = {
    init() {
        this.notifButton = document.getElementById('notifButton');
        this.notifDrawer = document.getElementById('notifDrawer');
        this.notifOverlay = document.getElementById('notifOverlay');
        this.notifList = document.getElementById('notifList');
        this.notifBadge = document.getElementById('notifBadge');
        this.closeNotif = document.getElementById('closeNotif');

        this.notifButton.addEventListener('click', () => this.toggleDrawer(true));
        this.closeNotif.addEventListener('click', () => this.toggleDrawer(false));
        this.notifOverlay.addEventListener('click', () => this.toggleDrawer(false));

        window.addEventListener('alertsChanged', () => this.renderAlerts());
        this.renderAlerts();

        if (Notification.permission === 'default') {
            Notification.requestPermission();
        }
    },

    toggleDrawer(open) {
        if (open) {
            this.notifDrawer.classList.remove('translate-x-full');
            this.notifOverlay.classList.remove('hidden');
            Store.markAlertsAsRead();
        } else {
            this.notifDrawer.classList.add('translate-x-full');
            this.notifOverlay.classList.add('hidden');
        }
    },

    renderAlerts() {
        const alerts = Store.getAlerts();
        const unreadCount = alerts.filter(a => !a.read).length;

        if (unreadCount > 0) {
            this.notifBadge.classList.remove('hidden');
        } else {
            this.notifBadge.classList.add('hidden');
        }

        if (alerts.length === 0) {
            this.notifList.innerHTML = `<div class="text-center opacity-50 py-10">Aucune notification</div>`;
            return;
        }

        this.notifList.innerHTML = alerts.map(alert => `
            <div class="p-4 rounded-xl border border-outline-variant ${alert.read ? 'opacity-60' : 'bg-primary/5'} flex gap-3">
                <span class="material-symbols-outlined ${alert.type === 'error' ? 'text-error' : 'text-primary'}">
                    ${alert.type === 'error' ? 'warning' : 'info'}
                </span>
                <div class="flex-1">
                    <div class="flex justify-between items-start">
                        <h4 class="font-bold text-sm">${alert.title}</h4>
                        <span class="text-[10px] opacity-60">${new Date(alert.timestamp).toLocaleTimeString()}</span>
                    </div>
                    <p class="text-xs mt-1">${alert.message}</p>
                </div>
            </div>
        `).join('');
    },

    sendPush(title, body) {
        if (Notification.permission === 'granted') {
            new Notification(title, { body, icon: 'icons/icon-192.png' });
        }
        Store.addAlert({ title, message: body, type: 'info' });
    },

    sendError(title, body) {
        Store.addAlert({ title, message: body, type: 'error' });
    }
};
