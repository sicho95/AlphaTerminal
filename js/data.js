import { getPortfolios, saveData, getData, totals, getSettings } from './store.js';

export const DEFAULT_DATA = {
  schemaVersion: 2,
  owners: [],
  portfolios: []
};

export const INVESTOR_PROFILES = {
  prudent: { label: 'Prudent', objective: '3-5%/an', horizon: '< 3 ans', rate: 0.04, target: { Actions: 30, Obligations: 50, Liquidités: 20, Crypto: 0 }, etf: 'ETF obligataire court terme + fonds monétaire' },
  equilibre: { label: 'Equilibre', objective: '5-8%/an', horizon: '3-7 ans', rate: 0.065, target: { Actions: 50, Obligations: 35, Liquidités: 15, Crypto: 0 }, etf: 'MSCI World + obligations EUR' },
  dynamique: { label: 'Dynamique', objective: '8-12%/an', horizon: '5-10 ans', rate: 0.10, target: { Actions: 70, Obligations: 15, Liquidités: 15, Crypto: 0 }, etf: 'MSCI World / Nasdaq via PEA' },
  offensif: { label: 'Offensif', objective: '12-20%/an', horizon: '> 7 ans', rate: 0.15, target: { Actions: 90, Obligations: 0, Liquidités: 10, Crypto: 0 }, etf: 'Nasdaq-100 + MSCI World' },
  dca: { label: 'DCA Automatique', objective: 'cumulatif configurable', horizon: 'regulier', rate: 0.08, target: { Actions: 75, Obligations: 10, Liquidités: 15, Crypto: 0 }, etf: 'Plan DCA MSCI World' }
};

export const MACRO_EVENTS = [
  { title: 'Taux Fed/BCE', sentiment: 'Neutre', summary: 'Les banques centrales restent restrictives, mais la volatilite des taux baisse.', tags: ['Finance', 'Obligations', 'World'], impact: { World: 1, Tech: -1 } },
  { title: 'Energie', sentiment: 'Positif', summary: 'Prix du gaz normalises en Europe, soutien aux marges industrielles.', tags: ['Energy', 'Europe'], impact: { Energy: 2, Europe: 1 } },
  { title: 'Geopolitique', sentiment: 'Negatif', summary: 'Tensions commerciales persistantes sur semi-conducteurs et chaines logistiques.', tags: ['Tech', 'Emerging'], impact: { Tech: -2, Emerging: -1 } },
  { title: 'Devise EUR/USD', sentiment: 'Neutre', summary: 'Euro stable contre dollar, impact limite sur ETF monde non couverts.', tags: ['World', 'Devise'], impact: { World: 0 } }
];

const yahooUrl = ticker => `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=1y&interval=1d`;
const twelveUrl = (ticker, apiKey) => `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(ticker)}&interval=1day&outputsize=260&apikey=${encodeURIComponent(apiKey)}`;
const proxied = url => {
  const proxy = getSettings().corsProxy || 'https://api.allorigins.win/raw?url=';
  return proxy.includes('{url}') ? proxy.replace('{url}', encodeURIComponent(url)) : proxy + encodeURIComponent(url);
};

export async function fetchTwelveDataChart(ticker, apiKey) {
  if (!ticker) throw new Error('Ticker manquant');
  if (!apiKey) throw new Error('Cle Twelve Data absente');
  const response = await fetch(twelveUrl(ticker, apiKey));
  if (!response.ok) throw new Error(`Twelve Data indisponible pour ${ticker}`);
  const json = await response.json();
  if (json.status === 'error') throw new Error(json.message || `Twelve Data erreur pour ${ticker}`);
  const values = Array.isArray(json.values) ? json.values.slice().reverse() : [];
  if (!values.length) throw new Error(`Aucune donnee Twelve Data pour ${ticker}`);
  const closes = values.map(row => Number(row.close)).filter(Number.isFinite);
  const highs = values.map(row => Number(row.high)).filter(Number.isFinite);
  const lows = values.map(row => Number(row.low)).filter(Number.isFinite);
  const price = closes.at(-1);
  return { closes, highs, lows, price };
}

export async function fetchYahooChart(ticker) {
  if (!ticker) throw new Error('Ticker Yahoo manquant');
  const response = await fetch(proxied(yahooUrl(ticker)));
  if (!response.ok) throw new Error(`Cours indisponible pour ${ticker}`);
  const json = await response.json();
  const result = json.chart?.result?.[0];
  if (!result) throw new Error(`Reponse Yahoo invalide pour ${ticker}`);
  const quote = result.indicators.quote[0];
  return {
    closes: quote.close.filter(Number.isFinite),
    highs: quote.high.filter(Number.isFinite),
    lows: quote.low.filter(Number.isFinite),
    price: result.meta.regularMarketPrice || result.meta.previousClose
  };
}

export async function fetchMarketChart(position) {
  const settings = getSettings();
  const symbol = position.yahooTicker || position.ticker;
  if (settings.dataProvider === 'twelvedata' && settings.twelveDataApiKey) {
    try {
      return await fetchTwelveDataChart(symbol, settings.twelveDataApiKey);
    } catch (error) {
      if (!settings.yahooFallback) throw error;
    }
  }
  return fetchYahooChart(symbol);
}

export function calculateATR(highs = [], lows = [], closes = [], period = 14) {
  if (highs.length < period + 1 || lows.length < period + 1 || closes.length < period + 1) return null;
  const trueRanges = [];
  for (let i = 1; i < highs.length; i += 1) {
    trueRanges.push(Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    ));
  }
  const slice = trueRanges.slice(-period);
  return slice.reduce((sum, value) => sum + value, 0) / slice.length;
}

export function suggestedStop(position, profileKey = getSettings().investorProfile) {
  const settings = getSettings();
  const atr = calculateATR(position.history?.highs, position.history?.lows, position.history?.closes);
  const multiplier = Number(position.atrMultiplier || settings.stopAtrMultipliers?.[profileKey] || 3);
  if (!atr || !position.currentPrice) return { atr: null, multiplier, stop: position.stopLevel || 0 };
  return { atr, multiplier, stop: Math.max(0, position.currentPrice - atr * multiplier) };
}

export async function refreshQuotes(onProgress = () => {}) {
  const current = getData();
  const nextPortfolios = [];
  for (const portfolio of getPortfolios()) {
    const positions = [];
    for (const position of portfolio.positions) {
      try {
        if (!position.yahooTicker && !position.ticker) throw new Error('Ticker absent');
        const chart = await fetchMarketChart(position);
        const nextPosition = { ...position, currentPrice: Number(chart.price.toFixed(2)), history: chart, lastUpdate: new Date().toISOString() };
        const stop = suggestedStop(nextPosition);
        positions.push({ ...nextPosition, suggestedStop: Number(stop.stop.toFixed(2)), atr14: stop.atr ? Number(stop.atr.toFixed(4)) : null });
        onProgress(position.ticker, true);
      } catch {
        positions.push({ ...position, lastUpdate: new Date().toISOString() });
        onProgress(position.ticker, false);
      }
    }
    nextPortfolios.push({ ...portfolio, positions });
  }
  saveData({ ...current, portfolios: nextPortfolios });
  return totals(nextPortfolios);
}
