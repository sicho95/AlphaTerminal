/**
 * AlphaTerminal Store
 * Handles Global State via LocalStorage
 */

const STORE_KEYS = {
    PORTFOLIOS: 'alphaTerm_portfolios',
    ALERTS: 'alphaTerm_alerts',
    SETTINGS: 'alphaTerm_settings',
    ACTIVE_ACCOUNT: 'alphaTerm_activeAccount'
};

export const Store = {
    // Portfolios
    getPortfolios() {
        const data = localStorage.getItem(STORE_KEYS.PORTFOLIOS);
        return data ? JSON.parse(data) : [];
    },

    savePortfolios(portfolios) {
        localStorage.setItem(STORE_KEYS.PORTFOLIOS, JSON.stringify(portfolios));
        this.dispatchEvent('portfoliosChanged', portfolios);
    },

    // Active Account
    getActiveAccountId() {
        return localStorage.getItem(STORE_KEYS.ACTIVE_ACCOUNT) || 'global';
    },

    setActiveAccountId(id) {
        localStorage.setItem(STORE_KEYS.ACTIVE_ACCOUNT, id);
        this.dispatchEvent('accountChanged', id);
    },

    // Alerts
    getAlerts() {
        const data = localStorage.getItem(STORE_KEYS.ALERTS);
        return data ? JSON.parse(data) : [];
    },

    addAlert(alert) {
        const alerts = this.getAlerts();
        alerts.unshift({
            id: Date.now(),
            timestamp: new Date().toISOString(),
            read: false,
            ...alert
        });
        // Keep only last 50
        const limitedAlerts = alerts.slice(0, 50);
        localStorage.setItem(STORE_KEYS.ALERTS, JSON.stringify(limitedAlerts));
        this.dispatchEvent('alertsChanged', limitedAlerts);
    },

    markAlertsAsRead() {
        const alerts = this.getAlerts().map(a => ({ ...a, read: true }));
        localStorage.setItem(STORE_KEYS.ALERTS, JSON.stringify(alerts));
        this.dispatchEvent('alertsChanged', alerts);
    },

    // Settings (Theme, etc.)
    getSettings() {
        const data = localStorage.getItem(STORE_KEYS.SETTINGS);
        return data ? JSON.parse(data) : {
            darkMode: false,
            notificationsEnabled: false,
            investorProfile: 'equilibre'
        };
    },

    saveSettings(settings) {
        const current = this.getSettings();
        const updated = { ...current, ...settings };
        localStorage.setItem(STORE_KEYS.SETTINGS, JSON.stringify(updated));
        this.dispatchEvent('settingsChanged', updated);
    },

    // Event System
    dispatchEvent(name, detail) {
        const event = new CustomEvent(name, { detail });
        window.dispatchEvent(event);
    }
};
