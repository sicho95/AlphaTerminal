/**
 * AlphaTerminal Main App Module
 * SPA Router & Lifecycle
 */

import { Store } from './store.js';
import { DataService, DEMO_PORTFOLIOS } from './data.js';
import { NotifService } from './notifications.js';

const App = {
    async init() {
        console.log('AlphaTerminal Initializing...');

        // Load settings
        const settings = Store.getSettings();
        this.applyTheme(settings.darkMode);

        // Initialize Demo Data if empty
        if (Store.getPortfolios().length === 0) {
            Store.savePortfolios(DEMO_PORTFOLIOS);
        }

        // Initialize Services
        NotifService.init();

        // Router Init
        window.addEventListener('hashchange', () => this.router());
        this.router();

        // Global Event Listeners
        this.initEventListeners();

        // Initial Account List
        this.updateAccountSelector();
    },

    async router() {
        const hash = window.location.hash || '#/dashboard';
        const page = hash.replace('#/', '');
        const content = document.getElementById('app-content');

        // Update Nav Active State
        this.updateNavLinks(hash);

        try {
            const response = await fetch(`./pages/${page}.html`);
            if (!response.ok) throw new Error('Page not found');
            const html = await response.text();

            // Clear and inject with script execution support
            content.innerHTML = '';
            content.appendChild(document.createRange().createContextualFragment(html));

            // Trigger Page-Specific Init
            setTimeout(() => this.initPage(page), 100);
        } catch (error) {
            console.error('Routing error:', error);
            content.innerHTML = `<div class="p-10 text-center text-error">Erreur de chargement de la page "${page}".</div>`;
        }
    },

    updateNavLinks(hash) {
        // Desktop Links
        document.querySelectorAll('.nav-link').forEach(link => {
            if (link.getAttribute('href') === hash) {
                link.classList.add('opacity-100', 'font-bold');
                link.classList.remove('opacity-80');
            } else {
                link.classList.remove('opacity-100', 'font-bold');
                link.classList.add('opacity-80');
            }
        });

        // Mobile Links
        document.querySelectorAll('.mobile-nav-link').forEach(link => {
            if (link.getAttribute('href') === hash) {
                link.classList.add('opacity-100', 'text-primary', 'dark:text-white');
                link.classList.remove('opacity-60');
            } else {
                link.classList.remove('opacity-100', 'text-primary', 'dark:text-white');
                link.classList.add('opacity-60');
            }
        });
    },

    initPage(page) {
        // Here we would call functions from other modules to populate the page
        // For now, let's just emit an event
        const event = new CustomEvent('pageLoaded', { detail: { page } });
        window.dispatchEvent(event);
    },

    initEventListeners() {
        // Theme Toggle
        document.getElementById('themeToggle').addEventListener('click', () => {
            const settings = Store.getSettings();
            const newMode = !settings.darkMode;
            Store.saveSettings({ darkMode: newMode });
            this.applyTheme(newMode);
        });

        // Account Change
        window.addEventListener('accountChanged', (e) => {
            const portfolios = Store.getPortfolios();
            const activeId = e.detail;
            const activeAccount = portfolios.find(p => p.id === activeId);
            document.getElementById('activeAccountName').textContent = activeAccount ? activeAccount.name : 'Global';
            // Reload page content to refresh data
            this.router();
        });
    },

    applyTheme(dark) {
        const html = document.documentElement;
        const icon = document.getElementById('themeIcon');
        if (dark) {
            html.classList.add('dark');
            icon.textContent = 'light_mode';
        } else {
            html.classList.remove('dark');
            icon.textContent = 'dark_mode';
        }
    },

    updateAccountSelector() {
        const portfolios = Store.getPortfolios();
        const list = document.getElementById('accountList');
        const activeId = Store.getActiveAccountId();

        let html = `
            <button class="account-item text-left px-3 py-2 rounded-lg text-sm hover:bg-black/5 dark:hover:bg-white/5 ${activeId === 'global' ? 'font-bold bg-primary/10' : ''}" data-id="global">
                Global
            </button>
            <div class="h-px bg-outline-variant my-1"></div>
        `;

        html += portfolios.map(p => `
            <button class="account-item text-left px-3 py-2 rounded-lg text-sm hover:bg-black/5 dark:hover:bg-white/5 ${activeId === p.id ? 'font-bold bg-primary/10' : ''}" data-id="${p.id}">
                ${p.name}
            </button>
        `).join('');

        list.innerHTML = html;

        list.querySelectorAll('.account-item').forEach(btn => {
            btn.addEventListener('click', () => {
                Store.setActiveAccountId(btn.dataset.id);
            });
        });

        const activeAccount = portfolios.find(p => p.id === activeId);
        document.getElementById('activeAccountName').textContent = activeAccount ? activeAccount.name : 'Global';
    }
};

window.addEventListener('DOMContentLoaded', () => App.init());

export default App;
