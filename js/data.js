import { getPortfolios, saveData, getData, totals, getSettings, DEFAULT_INVESTOR_PROFILES } from './store.js';

export const DEFAULT_DATA = {
  schemaVersion: 2,
  owners: [],
  portfolios: []
};

export const INVESTOR_PROFILES = DEFAULT_INVESTOR_PROFILES;

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
  const profile = settings.investorProfiles?.[profileKey];
  const multiplier = Number(position.atrMultiplier || profile?.atrMultiplier || settings.stopAtrMultipliers?.[profileKey] || 3);
  if (!atr || !position.currentPrice) return { atr: null, multiplier, stop: position.stopLevel || 0 };
  return { atr, multiplier, stop: Math.max(0, position.currentPrice - atr * multiplier) };
}

export async function fetchMacroNews() {
  const settings = getSettings();
  const provider = settings.macroProvider || 'static';
  const query = settings.macroQuery || 'markets OR inflation OR geopolitics';
  if (provider === 'gdelt') return fetchGdeltNews(query);
  if (provider === 'marketaux' && settings.marketauxApiKey) return fetchMarketauxNews(query, settings.marketauxApiKey);
  if (provider === 'finnhub' && settings.finnhubApiKey) return fetchFinnhubNews(settings.finnhubApiKey);
  return MACRO_EVENTS.map(item => ({ ...item, source: 'Configuration statique offline' }));
}

async function fetchGdeltNews(query) {
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query)}&mode=ArtList&format=json&maxrecords=8&sort=hybridrel`;
  const response = await fetch(proxied(url));
  if (!response.ok) throw new Error('GDELT indisponible');
  const json = await response.json();
  return (json.articles || []).slice(0, 8).map(article => ({
    title: article.title || 'Actualite macro',
    summary: article.seendate ? `${article.domain || 'News'} · ${article.seendate}` : (article.domain || 'News mondiale'),
    sentiment: toneToSentiment(article.tone),
    tags: ['Macro', article.language || 'News'],
    source: article.domain || 'GDELT',
    url: article.url,
    impact: {}
  }));
}

async function fetchMarketauxNews(query, apiKey) {
  const url = `https://api.marketaux.com/v1/news/all?api_token=${encodeURIComponent(apiKey)}&search=${encodeURIComponent(query)}&language=en,fr&limit=8`;
  const response = await fetch(url);
  if (!response.ok) throw new Error('Marketaux indisponible');
  const json = await response.json();
  return (json.data || []).map(article => ({
    title: article.title || 'News marche',
    summary: article.description || article.snippet || '',
    sentiment: scoreToSentiment(article.sentiment_score),
    tags: (article.entities || []).slice(0, 3).map(entity => entity.symbol || entity.name).filter(Boolean),
    source: article.source || 'Marketaux',
    url: article.url,
    impact: {}
  }));
}

async function fetchFinnhubNews(apiKey) {
  const url = `https://finnhub.io/api/v1/news?category=general&token=${encodeURIComponent(apiKey)}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error('Finnhub indisponible');
  const json = await response.json();
  return (json || []).slice(0, 8).map(article => ({
    title: article.headline || 'News marche',
    summary: article.summary || '',
    sentiment: 'Neutre',
    tags: ['Finance'],
    source: article.source || 'Finnhub',
    url: article.url,
    impact: {}
  }));
}

function toneToSentiment(tone) {
  const value = Number(tone || 0);
  if (value > 1.5) return 'Positif';
  if (value < -1.5) return 'Negatif';
  return 'Neutre';
}

function scoreToSentiment(score) {
  const value = Number(score || 0);
  if (value > 0.15) return 'Positif';
  if (value < -0.15) return 'Negatif';
  return 'Neutre';
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
        const stop = suggestedStop(nextPosition, portfolio.profileId);
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
