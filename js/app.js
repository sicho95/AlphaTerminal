import { DEFAULT_DATA } from './data.js';
import { initStore, state, subscribe, getOwners, getPortfolios, setSelectedScope, getScopeLabel, getSettings, saveSettings, markAlertsRead } from './store.js';
import { NotifService } from './notifications.js';

const routes = new Set(['dashboard', 'analyse', 'signaux', 'inventaire']);

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

    document.getElementById('account-select')?.addEventListener('change', event => {
      setSelectedScope(event.target.value);
      this.router();
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
      window.dispatchEvent(new CustomEvent('pageLoaded', { detail: { page: route } }));
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
    const select = document.getElementById('account-select');
    if (!select) return;
    const selected = state.selectedScope;
    const owners = getOwners();
    const portfolios = getPortfolios();
    const html = [
      `<option value="all">Tous les portefeuilles</option>`,
      ...owners.map(owner => {
        const children = portfolios.filter(portfolio => portfolio.ownerId === owner.id)
          .map(portfolio => `<option value="portfolio:${portfolio.id}">  ${portfolio.name}</option>`)
          .join('');
        return `<option value="owner:${owner.id}">${owner.name}</option>${children}`;
      })
    ].join('');
    select.innerHTML = html || `<option value="all">Aucune donnee</option>`;
    select.value = selected;
    select.title = getScopeLabel();
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
