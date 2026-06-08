export const SCHEMA_VERSION = 2;

export const KEYS = {
  data: 'alphaTerm_data',
  legacyPortfolios: 'alphaTerm_portfolios',
  alerts: 'alphaTerm_alerts',
  settings: 'alphaTerm_settings',
  selectedScope: 'alphaTerm_selectedScope',
  orderBasket: 'alphaTerm_orderBasket'
};

const defaultSettings = {
  darkMode: false,
  investorProfile: 'equilibre',
  notificationsEnabled: false,
  importMode: 'replace',
  currency: 'EUR',
  peaLimit: 150000,
  dataProvider: 'twelvedata',
  twelveDataApiKey: '',
  corsProxy: 'https://proxy.sicho95.workers.dev?url=',
  yahooFallback: true,
  stopAtrMultipliers: {
    prudent: 2,
    equilibre: 3,
    dynamique: 3,
    offensif: 4,
    dca: 3
  }
};

export const state = {
  data: { schemaVersion: SCHEMA_VERSION, owners: [], portfolios: [] },
  alerts: [],
  settings: { ...defaultSettings },
  selectedScope: 'all',
  listeners: new Set()
};

export const uid = prefix => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function writeJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function ownerSlug(name) {
  return String(name || 'owner').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function normalizePortfolio(portfolio) {
  const ownerName = portfolio.owner || 'Jean';
  const ownerId = portfolio.ownerId || ownerSlug(ownerName);
  return {
    id: portfolio.id || uid('portfolio'),
    ownerId,
    name: portfolio.name || `${ownerName} ${portfolio.type || 'CTO'}`,
    type: portfolio.type || 'CTO',
    color: portfolio.color || '#2563eb',
    versements: Number(portfolio.versements || 0),
    deposits: Array.isArray(portfolio.deposits) ? portfolio.deposits : [],
    positions: Array.isArray(portfolio.positions) ? portfolio.positions.map(position => ({
      id: position.id || uid('position'),
      ticker: position.ticker || '',
      yahooTicker: position.yahooTicker || position.ticker || '',
      isin: position.isin || '',
      name: position.name || position.ticker || 'Position',
      assetClass: position.assetClass || position.type || 'Actions',
      sector: position.sector || 'World',
      currency: position.currency || 'EUR',
      qty: Number(position.qty || 0),
      pru: Number(position.pru || 0),
      currentPrice: Number(position.currentPrice || position.pru || 0),
      stopLevel: Number(position.stopLevel || 0),
      lastUpdate: position.lastUpdate || null,
      history: position.history || null
    })) : []
  };
}

function normalizeData(input) {
  const legacy = Array.isArray(input) ? { portfolios: input } : (input || {});
  const portfolios = (legacy.portfolios || []).map(normalizePortfolio);
  const ownersById = new Map();

  (legacy.owners || []).forEach(owner => {
    const id = owner.id || ownerSlug(owner.name);
    ownersById.set(id, { id, name: owner.name || id, color: owner.color || '#2563eb' });
  });

  portfolios.forEach(portfolio => {
    if (!ownersById.has(portfolio.ownerId)) {
      const fallbackName = portfolio.owner || portfolio.name.split(/[—-]/)[0].trim() || portfolio.ownerId;
      ownersById.set(portfolio.ownerId, { id: portfolio.ownerId, name: fallbackName, color: portfolio.color });
    }
  });

  return {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: legacy.exportedAt || null,
    owners: Array.from(ownersById.values()),
    portfolios
  };
}

export function initStore(defaultData) {
  const stored = readJSON(KEYS.data, null);
  const legacy = readJSON(KEYS.legacyPortfolios, null);
  state.data = normalizeData(stored || legacy || defaultData);
  state.alerts = readJSON(KEYS.alerts, []);
  state.settings = { ...defaultSettings, ...readJSON(KEYS.settings, {}) };
  state.selectedScope = localStorage.getItem(KEYS.selectedScope) || 'all';
  persistData();
  writeJSON(KEYS.alerts, state.alerts);
  writeJSON(KEYS.settings, state.settings);
  return state;
}

export function subscribe(listener) {
  state.listeners.add(listener);
  return () => state.listeners.delete(listener);
}

export function emit() {
  state.listeners.forEach(listener => listener(state));
  window.dispatchEvent(new CustomEvent('alphaTerm:state', { detail: state }));
}

export function persistData() {
  writeJSON(KEYS.data, state.data);
  writeJSON(KEYS.legacyPortfolios, state.data.portfolios);
}

export function getData() {
  return state.data;
}

export function saveData(data) {
  state.data = normalizeData(data);
  persistData();
  emit();
}

export function getOwners() {
  return state.data.owners;
}

export function getPortfolios() {
  return state.data.portfolios;
}

export function saveSettings(settings) {
  state.settings = { ...state.settings, ...settings };
  writeJSON(KEYS.settings, state.settings);
  emit();
}

export function getSettings() {
  return state.settings;
}

export function setSelectedScope(scope) {
  state.selectedScope = scope || 'all';
  localStorage.setItem(KEYS.selectedScope, state.selectedScope);
  emit();
}

export function getScopeLabel(scope = state.selectedScope) {
  if (scope === 'all') return 'Tous';
  if (scope.startsWith('owner:')) return getOwners().find(owner => owner.id === scope.slice(6))?.name || 'Propriétaire';
  if (scope.startsWith('portfolio:')) return getPortfolios().find(portfolio => portfolio.id === scope.slice(10))?.name || 'Portefeuille';
  return 'Tous';
}

export function getVisiblePortfolios(scope = state.selectedScope) {
  if (scope === 'all') return getPortfolios();
  if (scope.startsWith('owner:')) {
    const ownerId = scope.slice(6);
    return getPortfolios().filter(portfolio => portfolio.ownerId === ownerId);
  }
  if (scope.startsWith('portfolio:')) {
    const portfolioId = scope.slice(10);
    return getPortfolios().filter(portfolio => portfolio.id === portfolioId);
  }
  return getPortfolios();
}

export function flattenPositions(portfolios = getVisiblePortfolios()) {
  return portfolios.flatMap(portfolio => {
    const owner = getOwners().find(item => item.id === portfolio.ownerId);
    return portfolio.positions.map(position => ({
      ...position,
      portfolioId: portfolio.id,
      accountId: portfolio.id,
      accountName: portfolio.name,
      accountType: portfolio.type,
      portfolioColor: portfolio.color,
      ownerId: portfolio.ownerId,
      ownerName: owner?.name || portfolio.ownerId,
      versements: portfolio.versements || 0
    }));
  });
}

export function totals(portfolios = getVisiblePortfolios()) {
  const positions = flattenPositions(portfolios);
  const invested = positions.reduce((sum, p) => sum + p.qty * p.pru, 0);
  const value = positions.reduce((sum, p) => sum + p.qty * p.currentPrice, 0);
  const gain = value - invested;
  const peaVersements = portfolios.filter(p => p.type === 'PEA').reduce((sum, p) => sum + Number(p.versements || 0), 0);
  return {
    positions,
    invested,
    value,
    gain,
    perf: invested ? gain / invested * 100 : 0,
    peaVersements,
    portfolioCount: portfolios.length
  };
}

export function addOwner(owner) {
  const name = owner.name?.trim();
  if (!name) throw new Error('Nom propriétaire requis');
  const id = owner.id || ownerSlug(name);
  if (state.data.owners.some(item => item.id === id)) throw new Error('Ce propriétaire existe déjà');
  saveData({ ...state.data, owners: [...state.data.owners, { id, name, color: owner.color || '#2563eb' }] });
  return id;
}

export function upsertPortfolio(portfolio) {
  const next = normalizePortfolio(portfolio);
  if (!state.data.owners.some(owner => owner.id === next.ownerId)) {
    throw new Error('Propriétaire inconnu');
  }
  const exists = state.data.portfolios.some(item => item.id === next.id);
  const portfolios = exists
    ? state.data.portfolios.map(item => item.id === next.id ? { ...item, ...next } : item)
    : [...state.data.portfolios, next];
  saveData({ ...state.data, portfolios });
  return next.id;
}

export function deletePortfolio(portfolioId) {
  saveData({ ...state.data, portfolios: state.data.portfolios.filter(portfolio => portfolio.id !== portfolioId) });
  if (state.selectedScope === `portfolio:${portfolioId}`) setSelectedScope('all');
}

export function upsertPosition(portfolioId, position) {
  const next = { ...normalizePortfolio({ positions: [position] }).positions[0], id: position.id || uid('position') };
  saveData({
    ...state.data,
    portfolios: state.data.portfolios.map(portfolio => portfolio.id !== portfolioId ? portfolio : {
      ...portfolio,
      positions: portfolio.positions.some(item => item.id === next.id)
        ? portfolio.positions.map(item => item.id === next.id ? { ...item, ...next } : item)
        : [...portfolio.positions, next]
    })
  });
  return next.id;
}

export function deletePosition(portfolioId, positionId) {
  saveData({
    ...state.data,
    portfolios: state.data.portfolios.map(portfolio => portfolio.id !== portfolioId ? portfolio : {
      ...portfolio,
      positions: portfolio.positions.filter(position => position.id !== positionId)
    })
  });
}

export function addDeposit(portfolioId, deposit) {
  const amount = Number(deposit.amount || 0);
  if (!amount) throw new Error('Montant requis');
  saveData({
    ...state.data,
    portfolios: state.data.portfolios.map(portfolio => portfolio.id !== portfolioId ? portfolio : {
      ...portfolio,
      versements: Number(portfolio.versements || 0) + amount,
      deposits: [...(portfolio.deposits || []), { id: uid('deposit'), date: deposit.date || new Date().toISOString().slice(0, 10), amount, note: deposit.note || '' }]
    })
  });
}

export function addAlert(alert) {
  const item = { id: uid('alert'), timestamp: new Date().toISOString(), read: false, ...alert };
  state.alerts = [item, ...state.alerts].slice(0, 80);
  writeJSON(KEYS.alerts, state.alerts);
  emit();
  return item;
}

export function markAlertsRead() {
  state.alerts = state.alerts.map(alert => ({ ...alert, read: true }));
  writeJSON(KEYS.alerts, state.alerts);
  emit();
}

export function exportBackup() {
  return {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    settings: state.settings,
    selectedScope: state.selectedScope,
    alerts: state.alerts,
    data: state.data
  };
}

export function importBackup(payload, mode = 'replace') {
  const incoming = payload.data ? normalizeData(payload.data) : normalizeData(payload);
  if (mode === 'merge') {
    const ownerIds = new Set(state.data.owners.map(owner => owner.id));
    const portfolioIds = new Set(state.data.portfolios.map(portfolio => portfolio.id));
    saveData({
      schemaVersion: SCHEMA_VERSION,
      owners: [...state.data.owners, ...incoming.owners.filter(owner => !ownerIds.has(owner.id))],
      portfolios: [...state.data.portfolios, ...incoming.portfolios.filter(portfolio => !portfolioIds.has(portfolio.id))]
    });
  } else {
    saveData(incoming);
  }
  if (payload.settings) saveSettings(payload.settings);
  if (Array.isArray(payload.alerts)) {
    state.alerts = payload.alerts;
    writeJSON(KEYS.alerts, state.alerts);
  }
  emit();
}

export const money = value => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(value || 0);
export const money2 = value => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(value || 0);
export const pct = value => `${(value || 0).toLocaleString('fr-FR', { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%`;
