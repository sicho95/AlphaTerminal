export const SCHEMA_VERSION = 2;
export const PROFILE_DEFAULTS_VERSION = 3;
export const APP_VERSION = '0.9.6';

export const KEYS = {
  data: 'alphaTerm_data',
  legacyPortfolios: 'alphaTerm_portfolios',
  alerts: 'alphaTerm_alerts',
  settings: 'alphaTerm_settings',
  selectedScope: 'alphaTerm_selectedScope',
  orderBasket: 'alphaTerm_orderBasket'
};

export const DEFAULT_INVESTOR_PROFILES = {
  prudent: { label: 'Prudent', objective: '3-5%/an', horizon: '< 3 ans', rate: 0.04, atrMultiplier: 2, target: { Actions: 25, Obligations: 60, Liquidités: 15, Crypto: 0 }, etfShare: 65, etf: 'ETF monétaire/obligataire EUR court terme + MSCI World plafonné' },
  equilibre: { label: 'Equilibre', objective: '5-8%/an', horizon: '3-7 ans', rate: 0.065, atrMultiplier: 2.5, target: { Actions: 60, Obligations: 35, Liquidités: 5, Crypto: 0 }, etfShare: 75, etf: 'ETF MSCI World coeur + obligations EUR diversifiées' },
  dynamique: { label: 'Dynamique', objective: '8-12%/an', horizon: '5-10 ans', rate: 0.10, atrMultiplier: 3, target: { Actions: 95, Obligations: 0, Liquidités: 5, Crypto: 0 }, etfShare: 80, etf: 'ETF MSCI World PEA coeur + actions satellites' },
  offensif: { label: 'Offensif', objective: '12-20%/an', horizon: '> 7 ans', rate: 0.15, atrMultiplier: 4, target: { Actions: 95, Obligations: 0, Liquidités: 5, Crypto: 0 }, etfShare: 65, etf: 'ETF Monde/Nasdaq coeur + actions de conviction plafonnees' },
  dca: { label: 'DCA Automatique', objective: 'cumulatif configurable', horizon: 'regulier', rate: 0.08, atrMultiplier: 3, target: { Actions: 95, Obligations: 0, Liquidités: 5, Crypto: 0 }, etfShare: 90, etf: 'Plan DCA MSCI World PEA, complement ETF/action modere' }
};

const defaultSettings = {
  darkMode: false,
  profileDefaultsVersion: PROFILE_DEFAULTS_VERSION,
  investorProfile: 'equilibre',
  investorProfiles: DEFAULT_INVESTOR_PROFILES,
  notificationsEnabled: false,
  importMode: 'replace',
  currency: 'EUR',
  peaLimit: 150000,
  dataProvider: 'yahoo',
  twelveDataApiKey: '',
  corsProxy: 'https://proxy.sicho95.workers.dev?url=',
  yahooFallback: true,
  autoRefreshMinutes: 10,
  lastQuotesRefreshAt: '',
  macroProvider: 'static',
  marketauxApiKey: '',
  finnhubApiKey: '',
  macroQuery: 'central banks OR inflation OR energy OR geopolitics OR markets',
  macroLanguage: 'fr,en',
  stopAtrMultipliers: {
    prudent: 2,
    equilibre: 2.5,
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
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
  }
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
    profileId: portfolio.profileId || portfolio.investorProfile || 'equilibre',
    color: portfolio.color || '#2563eb',
    versements: parseLocaleNumber(portfolio.versements),
    deposits: Array.isArray(portfolio.deposits) ? portfolio.deposits : [],
    currentCash: parseLocaleNumber(portfolio.currentCash || portfolio.cash),
    initialSituation: normalizeSituation(portfolio.initialSituation || portfolio.initial),
    targetSituation: normalizeTargetSituation(portfolio.targetSituation || portfolio.cible || portfolio.target),
    positions: Array.isArray(portfolio.positions) ? portfolio.positions.map(position => ({
      id: position.id || uid('position'),
      ticker: position.ticker || '',
      yahooTicker: position.yahooTicker || position.ticker || '',
      isin: position.isin || '',
      name: position.name || position.ticker || 'Position',
      assetClass: position.assetClass || position.type || 'Actions',
      sector: position.sector || 'World',
      currency: position.currency || 'EUR',
      qty: round3(parseLocaleNumber(position.qty)),
      pru: round3(parseLocaleNumber(position.pru)),
      currentPrice: round3(parseLocaleNumber(position.currentPrice || position.pru)),
      stopLevel: round3(parseLocaleNumber(position.stopLevel)),
      atrMultiplier: position.atrMultiplier ? round3(parseLocaleNumber(position.atrMultiplier)) : undefined,
      lastUpdate: position.lastUpdate || null,
      lastQuoteSource: position.lastQuoteSource || '',
      lastQuoteSymbol: position.lastQuoteSymbol || '',
      lastQuoteStatus: position.lastQuoteStatus || '',
      lastQuoteError: position.lastQuoteError || '',
      history: position.history || null
    })) : []
  };
}

export function round3(value) {
  return Math.round(parseLocaleNumber(value) * 1000) / 1000;
}

export function parseLocaleNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const raw = String(value ?? '').trim();
  if (!raw) return 0;
  const compact = raw.replace(/[\s\u202f\u00a0€%']/g, '').replace(/[^\d,.-]/g, '');
  const comma = compact.lastIndexOf(',');
  const dot = compact.lastIndexOf('.');
  let normalized = compact;

  if (comma !== -1 && dot !== -1) {
    const decimalSeparator = comma > dot ? ',' : '.';
    const thousandsSeparator = decimalSeparator === ',' ? '.' : ',';
    normalized = compact.split(thousandsSeparator).join('').replace(decimalSeparator, '.');
  } else if (comma !== -1) {
    normalized = compact.replace(',', '.');
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function decimal(value, digits = 3) {
  return round3(value).toLocaleString('fr-FR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits
  });
}

function normalizeSituation(situation = {}) {
  return {
    date: situation.date || '',
    total: parseLocaleNumber(situation.total),
    titres: parseLocaleNumber(situation.titres),
    especes: parseLocaleNumber(situation.especes),
    apportAnnuel: parseLocaleNumber(situation.apportAnnuel)
  };
}

function normalizeTargetSituation(target = {}) {
  return {
    date: target.date || target.targetDate || '',
    value: parseLocaleNumber(target.value || target.valeurCible || target.targetValue),
    returnPct: parseLocaleNumber(target.returnPct || target.rendementPct)
  };
}

function normalizeProfiles(profiles = {}) {
  const merged = { ...DEFAULT_INVESTOR_PROFILES, ...profiles };
  return Object.fromEntries(Object.entries(merged).map(([id, profile]) => [id, {
    ...DEFAULT_INVESTOR_PROFILES[id],
    ...profile,
    target: { ...(DEFAULT_INVESTOR_PROFILES[id]?.target || {}), ...(profile.target || {}) },
    etfShare: Number(profile.etfShare ?? profile.target?.ETF ?? DEFAULT_INVESTOR_PROFILES[id]?.etfShare ?? 0),
    rate: Number(profile.rate ?? DEFAULT_INVESTOR_PROFILES[id]?.rate ?? 0.08),
    atrMultiplier: Number(profile.atrMultiplier ?? profile.atr ?? DEFAULT_INVESTOR_PROFILES[id]?.atrMultiplier ?? 3)
  }]));
}

function normalizeSettings(settings = {}) {
  const merged = { ...defaultSettings, ...settings };
  if (settings.profileDefaultsVersion !== PROFILE_DEFAULTS_VERSION) {
    const customProfiles = Object.fromEntries(Object.entries(settings.investorProfiles || {}).filter(([id]) => !DEFAULT_INVESTOR_PROFILES[id]));
    merged.investorProfiles = { ...DEFAULT_INVESTOR_PROFILES, ...customProfiles };
  }
  merged.investorProfiles = normalizeProfiles(merged.investorProfiles);
  merged.profileDefaultsVersion = PROFILE_DEFAULTS_VERSION;
  merged.stopAtrMultipliers = {
    ...defaultSettings.stopAtrMultipliers,
    ...merged.stopAtrMultipliers,
    ...Object.fromEntries(Object.entries(merged.investorProfiles).map(([id, profile]) => [id, profile.atrMultiplier]))
  };
  return merged;
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
  state.settings = normalizeSettings(readJSON(KEYS.settings, {}));
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
  state.settings = normalizeSettings({ ...state.settings, ...settings });
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
      profileId: portfolio.profileId || 'equilibre',
      portfolioColor: portfolio.color,
      ownerId: portfolio.ownerId,
      ownerName: owner?.name || portfolio.ownerId,
      versements: portfolio.versements || 0,
      currentCash: portfolio.currentCash || 0
    }));
  });
}

export function totals(portfolios = getVisiblePortfolios()) {
  const positions = flattenPositions(portfolios);
  const invested = positions.reduce((sum, p) => sum + p.qty * p.pru, 0);
  const positionsValue = positions.reduce((sum, p) => sum + p.qty * p.currentPrice, 0);
  const cash = portfolios.reduce((sum, p) => sum + Number(p.currentCash || 0), 0);
  const value = positionsValue + cash;
  const gain = value - invested;
  const peaVersements = portfolios.filter(p => p.type === 'PEA').reduce((sum, p) => sum + Number(p.versements || 0), 0);
  const initialValue = portfolios.reduce((sum, p) => sum + Number(p.initialSituation?.total || 0), 0);
  const targetValue = portfolios.reduce((sum, p) => sum + Number(p.targetSituation?.value || 0), 0);
  return {
    positions,
    invested,
    positionsValue,
    cash,
    value,
    gain,
    perf: invested ? gain / invested * 100 : 0,
    initialValue,
    targetValue,
    progressToTarget: targetValue > initialValue ? (value - initialValue) / (targetValue - initialValue) * 100 : 0,
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
  if (next.qty <= 0) {
    if (position.id) deletePosition(portfolioId, position.id);
    return next.id;
  }
  const identity = positionIdentity(next);
  saveData({
    ...state.data,
    portfolios: state.data.portfolios.map(portfolio => portfolio.id !== portfolioId ? portfolio : {
      ...portfolio,
      positions: portfolio.positions.some(item => item.id === next.id || (!position.id && positionIdentity(item) === identity))
        ? portfolio.positions.map(item => item.id === next.id || (!position.id && positionIdentity(item) === identity) ? { ...item, ...next, id: item.id } : item)
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

export function clearAlerts() {
  state.alerts = [];
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
  const incoming = payload.data ? normalizeData({ ...payload.data, exportedAt: payload.exportedAt || payload.data.exportedAt }) : normalizeData(payload);
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
  if (payload.selectedScope) setSelectedScope(payload.selectedScope);
  emit();
}

export const money = value => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(value || 0);
export const money2 = value => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(value || 0);
export const pct = value => `${(value || 0).toLocaleString('fr-FR', { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%`;

function positionIdentity(position) {
  return [position.isin || '', position.ticker || '', position.name || ''].join('|').toLowerCase();
}
