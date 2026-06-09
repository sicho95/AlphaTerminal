import { DEFAULT_DATA, refreshQuotes } from './data.js';
import { initStore, state, subscribe, getOwners, getPortfolios, setSelectedScope, getScopeLabel, getSettings, saveSettings, markAlertsRead, clearAlerts } from './store.js';
import { NotifService } from './notifications.js';

const routes = new Set(['dashboard', 'analyse', 'signaux', 'inventaire', 'parametres']);

const App = {
  async init() {
    initStore(DEFAULT_DATA);
    this.applyTheme(getSettings().darkMode);
    this.bindShell();
    this.renderScopeSelect();
    this.renderNotifications();
    this.renderOnlineState();
    NotifService.init();

    subscribe(() => {
      this.renderScopeSelect();
      this.renderNotifications();
      this.renderOnlineState();
    });

    window.addEventListener('hashchange', () => this.router());
    window.addEventListener('online', () => this.renderOnlineState());
    window.addEventListener('offline', () => this.renderOnlineState());
    this.router();
    this.scheduleAutoRefresh();

    if ('serviceWorker' in navigator) {
      try {
        await navigator.serviceWorker.register('./sw.js');
      } catch (error) {
        console.warn('Service worker unavailable', error);
      }
    }
  },

  bindShell() {
    document.getElementById('dark-toggle')?.addEventListener('click', () => {
      const darkMode = !getSettings().darkMode;
      saveSettings({ darkMode });
      this.applyTheme(darkMode);
    });

    document.getElementById('scope-toggle')?.addEventListener('click', event => {
      event.stopPropagation();
      const menu = document.getElementById('scope-menu');
      const open = menu.classList.toggle('hidden');
      event.currentTarget.setAttribute('aria-expanded', String(!open));
    });

    document.getElementById('scope-menu')?.addEventListener('click', event => {
      const button = event.target.closest('[data-scope]');
      if (!button) return;
      setSelectedScope(button.dataset.scope);
      document.getElementById('scope-menu').classList.add('hidden');
      document.getElementById('scope-toggle')?.setAttribute('aria-expanded', 'false');
      this.router();
    });

    document.addEventListener('click', event => {
      if (event.target.closest('#scope-picker')) return;
      document.getElementById('scope-menu')?.classList.add('hidden');
      document.getElementById('scope-toggle')?.setAttribute('aria-expanded', 'false');
    });

    document.getElementById('notification-toggle')?.addEventListener('click', () => {
      const panel = document.getElementById('notification-panel');
      panel.classList.remove('hidden');
      requestAnimationFrame(() => panel.classList.remove('translate-x-full'));
    });

    document.getElementById('notification-close')?.addEventListener('click', () => {
      const panel = document.getElementById('notification-panel');
      panel.classList.add('translate-x-full');
      setTimeout(() => panel.classList.add('hidden'), 220);
      markAlertsRead();
    });

    document.getElementById('notification-clear')?.addEventListener('click', () => clearAlerts());
    document.getElementById('global-refresh')?.addEventListener('click', event => this.refreshAllQuotes(event.currentTarget, true));
  },

  async refreshAllQuotes(button = null, userTriggered = false) {
    if (this.refreshingQuotes) return;
    this.refreshingQuotes = true;
    button?.classList.add('is-loading');
    if (button) button.disabled = true;
    try {
      const result = await refreshQuotes();
      const stats = result.refreshStats || { updated: 0, failed: 0, total: 0, failures: [] };
      if (stats.failed) {
        const failedTickers = stats.failures.slice(0, 4).map(item => item.ticker).join(', ');
        NotifService.sendError('Actualisation partielle', `${stats.updated}/${stats.total} lignes mises a jour. Echecs: ${failedTickers || stats.failed}.`);
      } else if (userTriggered) {
        NotifService.push('Cours mis a jour', `${stats.updated}/${stats.total} lignes actualisees avec Yahoo Finance.`);
      }
      this.router();
    } catch {
      NotifService.sendError('Actualisation impossible', 'Yahoo Finance ou le proxy de cours est indisponible.');
    } finally {
      this.refreshingQuotes = false;
      button?.classList.remove('is-loading');
      if (button) button.disabled = false;
    }
  },

  scheduleAutoRefresh() {
    const run = () => {
      const settings = getSettings();
      const minutes = Number(settings.autoRefreshMinutes || 10);
      if (!minutes || minutes < 1) return;
      const last = settings.lastQuotesRefreshAt ? new Date(settings.lastQuotesRefreshAt).getTime() : 0;
      if (!last || Date.now() - last > minutes * 60 * 1000) this.refreshAllQuotes(null, false);
    };
    run();
    setInterval(run, 60 * 1000);
  },

  async router() {
    const page = (window.location.hash || '#/dashboard').replace('#/', '');
    const route = routes.has(page) ? page : 'dashboard';
    const content = document.getElementById('app-content');
    this.updateNav(route);

    try {
      const response = await fetch(`./pages/${route}.html`, { cache: navigator.onLine ? 'no-cache' : 'default' });
      if (!response.ok) throw new Error('Page not found');
      await this.injectPage(content, await response.text());
      content.focus({ preventScroll: true });
    } catch (error) {
      content.innerHTML = `<section class="empty-state"><h2>Page indisponible</h2><p>La page demandee ne peut pas etre chargee. Verifiez le cache offline ou revenez au tableau de bord.</p></section>`;
    }
  },

  async injectPage(content, html) {
    content.innerHTML = html;
    const scripts = Array.from(content.querySelectorAll('script'));
    await Promise.all(scripts.map(oldScript => new Promise(resolve => {
      const script = document.createElement('script');
      Array.from(oldScript.attributes).forEach(attr => script.setAttribute(attr.name, attr.value));
      script.textContent = oldScript.textContent;
      let settled = false;
      const done = () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      };
      oldScript.replaceWith(script);

      if (script.type === 'module' || script.src) {
        script.addEventListener('load', done, { once: true });
        script.addEventListener('error', done, { once: true });
        setTimeout(done, 50);
      } else {
        done();
      }
    })));
  },

  renderScopeSelect() {
    const menu = document.getElementById('scope-menu');
    const current = document.getElementById('scope-current');
    if (!menu || !current) return;
    const selected = state.selectedScope;
    const owners = getOwners();
    const portfolios = getPortfolios();
    current.textContent = getScopeLabel();
    if (!owners.length && !portfolios.length) {
      menu.innerHTML = `
        <button class="scope-node ${selected === 'all' ? 'is-active' : ''}" type="button" data-scope="all" role="treeitem">
          <span class="material-symbols-outlined">account_tree</span>Tous
        </button>
        <div class="scope-empty">Aucune structure. Importe un JSON ou cree un portefeuille.</div>
      `;
      return;
    }
    menu.innerHTML = [
      `<button class="scope-node ${selected === 'all' ? 'is-active' : ''}" type="button" data-scope="all" role="treeitem"><span class="material-symbols-outlined">account_tree</span>Tous</button>`,
      ...owners.map(owner => {
        const ownerScope = `owner:${owner.id}`;
        const children = portfolios.filter(portfolio => portfolio.ownerId === owner.id)
          .map(portfolio => {
            const portfolioScope = `portfolio:${portfolio.id}`;
            return `<button class="scope-node portfolio ${selected === portfolioScope ? 'is-active' : ''}" type="button" data-scope="${portfolioScope}" role="treeitem"><span class="material-symbols-outlined">subdirectory_arrow_right</span>${portfolio.name}</button>`;
          })
          .join('');
        return `
          <button class="scope-node ${selected === ownerScope ? 'is-active' : ''}" type="button" data-scope="${ownerScope}" role="treeitem" aria-expanded="true">
            <span class="material-symbols-outlined">person</span>${owner.name}
          </button>
          <div class="scope-children" role="group">${children || '<div class="scope-empty">Aucun portefeuille</div>'}</div>
        `;
      })
    ].join('');
  },

  renderNotifications() {
    const unread = state.alerts.filter(alert => !alert.read).length;
    const badge = document.getElementById('alert-badge');
    if (badge) {
      badge.textContent = unread;
      badge.classList.toggle('hidden', unread === 0);
    }

    const list = document.getElementById('notification-list');
    if (!list) return;
    if (!state.alerts.length) {
      list.innerHTML = `<div class="empty-state compact"><span class="material-symbols-outlined">notifications</span><p>Aucune alerte active.</p></div>`;
      return;
    }
    list.innerHTML = state.alerts.map(alert => `
      <article class="mini-card ${alert.read ? 'opacity-70' : ''}">
        <div class="flex items-start justify-between gap-3">
          <div>
            <p class="text-sm font-bold">${alert.title || alert.type || 'Alerte'}</p>
            <p class="mt-1 text-sm text-muted dark:text-slate-300">${alert.message || ''}</p>
          </div>
          <span class="status-pill ${alert.severity === 'error' ? 'danger' : 'neutral'}">${new Date(alert.timestamp).toLocaleDateString('fr-FR')}</span>
        </div>
      </article>
    `).join('');
  },

  renderOnlineState() {
    document.body.dataset.online = navigator.onLine ? 'true' : 'false';
  },

  applyTheme(dark) {
    document.documentElement.classList.toggle('dark', Boolean(dark));
    const icon = document.querySelector('#dark-toggle .material-symbols-outlined');
    if (icon) icon.textContent = dark ? 'light_mode' : 'dark_mode';
  },

  updateNav(route) {
    document.querySelectorAll('[data-route]').forEach(link => {
      const active = link.dataset.route === route;
      link.classList.toggle('is-active', active);
      link.setAttribute('aria-current', active ? 'page' : 'false');
    });
  }
};

window.addEventListener('DOMContentLoaded', () => App.init());

export default App;
