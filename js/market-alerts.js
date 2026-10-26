/** AlphaTerminal v1.0.0: evaluate alerts ONLY after a successful quote refresh.
 * This module never changes portfolio data and only records threshold transitions.
 * Diagnostic/financial alerting is indicative, not a broker stop order.
 */
import { getPortfolios, getSettings, readJSON, writeJSON } from './store.js';
import { NotifService } from './notifications.js';

const STATE_KEY = 'alphaTerm_alertStates';
const nearPct = 3;

export function calculateRsi14(values = []) {
  const closes = values.filter(Number.isFinite);
  if (closes.length < 15) return null;
  let gains = 0, losses = 0;
  for (let i = closes.length - 14; i < closes.length; i += 1) {
    const delta = closes[i] - closes[i - 1];
    gains += Math.max(0, delta);
    losses += Math.max(0, -delta);
  }
  if (losses === 0) return gains === 0 ? 50 : 100;
  return 100 - 100 / (1 + gains / losses);
}

export function evaluateMarketAlerts(portfolios = getPortfolios(), settings = getSettings()) {
  const states = readJSON(STATE_KEY, {});
  let emitted = 0;
  const seen = new Set();

  function transition(id, active, alert) {
    seen.add(id);
    if (active && !states[id]) {
      states[id] = { since: new Date().toISOString() };
      NotifService.push(alert.title, alert.message, alert.severity, { type: alert.type });
      emitted += 1;
    } else if (!active && states[id]) {
      delete states[id]; // Rearm only once the market returns outside the condition.
    }
  }

  for (const portfolio of portfolios) {
    for (const position of portfolio.positions || []) {
      // Stale prices can generate dangerous false stop notifications.
      if (position.lastQuoteStatus !== 'ok' || !position.lastUpdate) continue;
      const price = Number(position.currentPrice);
      const stop = Number(position.stopLevel);
      if (!(price > 0)) continue;
      const id = `${portfolio.id}:${position.id || position.isin || position.ticker}`;
      const ticker = position.ticker || position.name || 'Titre';
      const distance = stop > 0 ? (price - stop) / price * 100 : Infinity;
      const crossed = stop > 0 && price <= stop;
      const near = stop > 0 && price > stop && distance <= nearPct;
      const decimals = value => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 3 }).format(value);
      transition(`${id}:stop`, Boolean(settings.alertStopsEnabled !== false && crossed), {
        type: 'stop', severity: 'error',
        title: `Stop franchi — ${ticker}`,
        message: `${ticker} : cours ${decimals(price)} €, seuil ${decimals(stop)} €. Vérifie les données du marché.`
      });
      transition(`${id}:near`, Boolean(settings.alertStopNearEnabled !== false && near), {
        type: 'stop-near', severity: 'warning',
        title: `Stop proche — ${ticker}`,
        message: `${ticker} à ${decimals(distance)} % du seuil ${decimals(stop)} €.`
      });
      const pru = Number(position.pru);
      const performance = pru > 0 ? (price - pru) / pru * 100 : NaN;
      transition(`${id}:performance`, Boolean(settings.alertPerformanceEnabled && Number.isFinite(performance) && performance >= 12), {
        type: 'performance', severity: 'success',
        title: `Performance +12 % — ${ticker}`,
        message: `${ticker} : performance latente ${decimals(performance)} % sur le PRU.`
      });
      const rsi = calculateRsi14(position.history?.closes || []);
      transition(`${id}:rsi-low`, Boolean(settings.alertRsiEnabled && rsi !== null && rsi < 25), {
        type: 'rsi', severity: 'warning', title: `RSI faible — ${ticker}`,
        message: `${ticker} : RSI(14) ${decimals(rsi)}.`
      });
      transition(`${id}:rsi-high`, Boolean(settings.alertRsiEnabled && rsi !== null && rsi > 75), {
        type: 'rsi', severity: 'warning', title: `RSI élevé — ${ticker}`,
        message: `${ticker} : RSI(14) ${decimals(rsi)}.`
      });
    }
  }
  // Suppress old state only for positions no longer present; retain states of positions
  // whose quotes failed (so a feed outage will not rearm and spam alerts).
  const present = new Set(portfolios.flatMap(p => (p.positions || []).map(pos => `${p.id}:${pos.id || pos.isin || pos.ticker}`)));
  for (const key of Object.keys(states)) {
    if (!present.has(key.slice(0, key.lastIndexOf(':')))) delete states[key];
  }
  writeJSON(STATE_KEY, states);
  return emitted;
}
