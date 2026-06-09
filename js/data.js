import { getPortfolios, saveData, getData, totals, getSettings, saveSettings, DEFAULT_INVESTOR_PROFILES, readJSON, writeJSON, parseLocaleNumber, round3 } from './store.js';

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
const yahooNewsUrl = query => `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&newsCount=8&quotesCount=0&lang=fr-FR&region=FR`;
const MACRO_CACHE_KEY = 'alphaTerm_macroCache';
const MACRO_CACHE_TTL = 30 * 60 * 1000;
const GDELT_MIN_INTERVAL = 6000;
const GDELT_RATE_LIMIT_BACKOFF = 15 * 60 * 1000;
const MACRO_TOPICS = [
  { id: 'rates', label: 'Taux / banques centrales', impact: 5, keywords: ['fed', 'fomc', 'ecb', 'bce', 'boe', 'boj', 'pboc', 'central bank', 'banque centrale', 'interest rate', 'interest rates', 'policy rate', 'benchmark rate', 'yield', 'yields', 'bond market', 'treasury', 'treasuries', 'qt', 'quantitative tightening', 'quantitative easing'] },
  { id: 'inflation', label: 'Inflation', impact: 5, keywords: ['inflation', 'cpi', 'pce', 'ppi', 'consumer prices', 'producer prices', 'core inflation', 'price pressure', 'disinflation', 'deflation'] },
  { id: 'growth', label: 'Croissance / activite', impact: 4, keywords: ['gdp', 'gross domestic product', 'growth', 'slowdown', 'recession', 'soft landing', 'hard landing', 'pmi', 'ism', 'manufacturing', 'services activity', 'industrial production', 'retail sales', 'consumer spending', 'business activity'] },
  { id: 'employment', label: 'Emploi', impact: 4, keywords: ['jobs', 'job market', 'labour market', 'labor market', 'employment', 'payroll', 'nonfarm payroll', 'nfp', 'wages', 'wage growth', 'jobless claims', 'unemployment', 'layoffs'] },
  { id: 'energy', label: 'Energie / matieres premieres', impact: 4, keywords: ['oil', 'crude', 'brent', 'wti', 'gas', 'lng', 'opec', 'energy prices', 'power prices', 'electricity prices', 'commodity', 'commodities', 'copper', 'natural gas'] },
  { id: 'fx', label: 'Devises / dollar', impact: 3, keywords: ['dollar', 'usd', 'eur/usd', 'yuan', 'yen', 'fx', 'currency', 'currencies', 'exchange rate', 'forex'] },
  { id: 'credit', label: 'Credit / liquidite', impact: 4, keywords: ['credit', 'liquidity', 'default', 'defaults', 'downgrade', 'banking stress', 'bank failure', 'debt market', 'sovereign debt', 'funding stress', 'refinancing'] },
  { id: 'geopolitics', label: 'Geopolitique / commerce', impact: 5, keywords: ['tariff', 'tariffs', 'trade war', 'trade talks', 'sanction', 'sanctions', 'export curbs', 'export controls', 'conflict', 'military', 'war', 'ceasefire', 'shipping', 'strait', 'red sea', 'taiwan', 'ukraine', 'middle east', 'iran', 'china', 'embargo', 'blockade'] },
  { id: 'technology', label: 'Technologie / semi-conducteurs', impact: 3, keywords: ['chip', 'chips', 'semiconductor', 'semiconductors', 'ai', 'artificial intelligence', 'data center', 'cloud', 'gpu'] },
  { id: 'corporate', label: 'Entreprise / marche', impact: 1, keywords: ['ipo', 'earnings', 'quarterly results', 'shares', 'stock', 'stocks', 'deal', 'merger', 'acquisition', 'wall st', 'wall street', 'investors'] }
];
const MACRO_SENTIMENT_RULES = [
  { pattern: /\b(rate cut|cuts rates|cut rates|lower rates|easing cycle|policy easing|dovish|qe|quantitative easing|stimulus|reserve requirement cut)\b/g, score: 3, impact: 3, rationale: 'assouplissement monetaire' },
  { pattern: /\b(rate hike|hikes rates|raise rates|higher for longer|hawkish|tightening|qt|quantitative tightening)\b/g, score: -3, impact: 3, rationale: 'resserrement monetaire' },
  { pattern: /\b(inflation cools|inflation eased|inflation slows|cooling inflation|disinflation|below forecast|below expectations|price pressures ease)\b/g, score: 3, impact: 3, rationale: 'inflation en deceleration' },
  { pattern: /\b(sticky inflation|inflation rises|inflation accelerates|hot cpi|above forecast|above expectations|price pressures persist)\b/g, score: -3, impact: 3, rationale: 'inflation persistante' },
  { pattern: /\b(soft landing|gdp beats|growth beats|pmi rebounds|activity rebounds|retail sales beat|consumer spending rises|productivity rises)\b/g, score: 2, impact: 2, rationale: 'croissance plus solide' },
  { pattern: /\b(recession|hard landing|contraction|pmi slump|slowdown|weak demand|manufacturing slump|consumer weakness)\b/g, score: -3, impact: 2, rationale: 'ralentissement economique' },
  { pattern: /\b(payrolls beat|job growth accelerates|unemployment falls|wages cool)\b/g, score: 1, impact: 2, rationale: 'emploi resilient' },
  { pattern: /\b(jobless claims rise|unemployment rises|layoffs surge|job cuts|wage pressures)\b/g, score: -2, impact: 2, rationale: 'stress sur l emploi' },
  { pattern: /\b(oil falls|oil eases|gas prices fall|energy prices ease|supply resumes|output rises)\b/g, score: 2, impact: 2, rationale: 'energie moins inflationniste' },
  { pattern: /\b(oil spikes|oil surges|gas spikes|supply disruption|output cuts|opec cuts|shipping disruption)\b/g, score: -3, impact: 3, rationale: 'choc energie / logistique' },
  { pattern: /\b(ceasefire|trade deal|tariff relief|sanctions eased|export curbs eased|reopening)\b/g, score: 2, impact: 2, rationale: 'detente geopolitique' },
  { pattern: /\b(tariffs|sanctions|export controls|export curbs|conflict|military strike|missile|blockade|embargo|trade war)\b/g, score: -3, impact: 3, rationale: 'tension geopolitique' },
  { pattern: /\b(pentagon|military blacklist|blacklisted|aiding chinese military|national security)\b/g, score: -2, impact: 2, rationale: 'durcissement strategique' },
  { pattern: /\b(liquidity support|credit support|bank rescue|backstop|funding facility)\b/g, score: 2, impact: 2, rationale: 'soutien a la liquidite' },
  { pattern: /\b(default|defaults|downgrade|bank failure|funding stress|debt crisis|credit crunch)\b/g, score: -3, impact: 3, rationale: 'stress credit' },
  { pattern: /\b(chip rebound|semiconductor rebound|tech rebound|ai spending rises)\b/g, score: 1, impact: 1, rationale: 'soutien technologique' },
  { pattern: /\b(futures rise|stocks rise|stocks jump|rebound lifts|market rally|shares rally)\b/g, score: 1, impact: 1, rationale: 'rebond de marche' },
  { pattern: /\b(ipo|files confidentially for ipo|m&a|acquisition|quarterly results|earnings)\b/g, score: 0, impact: 0, rationale: 'nouvelle corporate' }
];

const proxied = url => {
  const proxy = getSettings().corsProxy || 'https://api.allorigins.win/raw?url=';
  return proxy.includes('{url}') ? proxy.replace('{url}', encodeURIComponent(url)) : proxy + encodeURIComponent(url);
};

export async function fetchYahooChart(ticker) {
  if (!ticker) throw new Error('Ticker Yahoo manquant');
  const response = await fetch(proxied(yahooUrl(ticker)));
  if (!response.ok) throw new Error(`Cours indisponible pour ${ticker}`);
  const json = await response.json();
  const result = json.chart?.result?.[0];
  if (!result) throw new Error(`Reponse Yahoo invalide pour ${ticker}`);
  const quote = result.indicators.quote[0];
  return {
    closes: quote.close.map(parseLocaleNumber).filter(isPositiveNumber),
    highs: quote.high.map(parseLocaleNumber).filter(isPositiveNumber),
    lows: quote.low.map(parseLocaleNumber).filter(isPositiveNumber),
    price: parseLocaleNumber(result.meta.regularMarketPrice || result.meta.previousClose),
    symbol: ticker,
    source: 'Yahoo'
  };
}

export async function fetchMarketChart(position) {
  const symbols = quoteSymbols(position);
  const errors = [];
  for (const symbol of symbols) {
    try {
      return await fetchYahooChart(symbol);
    } catch (error) {
      errors.push(`${symbol}: ${error.message}`);
    }
  }
  throw new Error(errors.join(' | ') || 'Aucune source de cours disponible');
}

function quoteSymbols(position) {
  const raw = [position.yahooTicker, position.ticker, position.isin]
    .map(value => String(value || '').trim())
    .filter(Boolean);
  const shouldTryParis = String(position.isin || '').toUpperCase().startsWith('FR')
    || (position.currency === 'EUR' && ['ETF', 'Actions'].includes(position.assetClass));
  const symbols = [];
  raw.forEach(symbol => {
    if (shouldTryParis && !symbol.includes('.') && !/^[A-Z]{2}\d/i.test(symbol)) symbols.push(`${symbol}.PA`);
    symbols.push(symbol);
  });
  return [...new Set(symbols)];
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

export function suggestedStop(position, profileKey = position.profileId || getSettings().investorProfile) {
  const settings = getSettings();
  const atr = calculateATR(position.history?.highs, position.history?.lows, position.history?.closes);
  const profile = settings.investorProfiles?.[profileKey];
  const multiplier = Number(position.atrMultiplier || profile?.atrMultiplier || settings.stopAtrMultipliers?.[profileKey] || 3);
  if (!atr || !position.currentPrice) return { atr: null, multiplier, stop: position.stopLevel || 0 };
  return { atr, multiplier, stop: Math.max(0, position.currentPrice - atr * multiplier) };
}

export function stopMetrics(position, profileKey = position.profileId || getSettings().investorProfile) {
  const stop = suggestedStop(position, profileKey);
  const current = parseLocaleNumber(position.currentPrice);
  const stopPct = current > 0 && stop.stop > 0 ? ((stop.stop / current) - 1) * 100 : null;
  const distancePct = current > 0 && position.stopLevel > 0 ? ((position.stopLevel / current) - 1) * 100 : null;
  return { ...stop, stopPct, distancePct };
}

export async function fetchMacroNews() {
  const settings = getSettings();
  const provider = settings.macroProvider || 'multi';
  const query = settings.macroQuery || 'markets OR inflation OR geopolitics';
  if (provider === 'multi') {
    const feeds = await fetchMacroFeeds(query, settings);
    return feeds.flatMap(feed => feed.events);
  }
  const cacheKey = `${provider}:${query}:${settings.macroLanguage || ''}`;
  const cached = readMacroCache(cacheKey);

  if (cached?.events?.length && Date.now() - cached.timestamp < MACRO_CACHE_TTL) {
    return cached.events.map(event => ({ ...event, source: event.source || `Cache ${provider}` }));
  }

  try {
    let events = [];
    if (provider === 'oksurf') events = await fetchOkSurfNews();
    if (provider === 'yahoo') events = await fetchYahooFinanceNews(query);
    if (provider === 'marketaux' && settings.marketauxApiKey) events = await fetchMarketauxNews(query, settings.marketauxApiKey);
    if (provider === 'finnhub' && settings.finnhubApiKey) events = await fetchFinnhubNews(settings.finnhubApiKey);
    if (events.length) {
      writeMacroCache(cacheKey, events);
      return events;
    }
  } catch {
  }
  if (cached?.events?.length) {
    return cached.events.map(event => ({ ...event, source: event.source || `Cache ${provider}` }));
  }
  return [];
}

export async function fetchMacroFeeds(query = '', settings = getSettings()) {
  const mode = settings.macroProvider || 'multi';
  const use = source => mode === 'multi' || mode === source;
  const tasks = [
    { id: 'yahoo', label: 'Yahoo Finance', enabled: use('yahoo'), run: () => fetchYahooFinanceNews(query || settings.macroQuery) },
    { id: 'oksurf', label: 'OKSURF', enabled: use('oksurf'), run: () => fetchOkSurfNews() },
    { id: 'marketaux', label: 'Marketaux', enabled: use('marketaux') && Boolean(settings.marketauxApiKey), run: () => fetchMarketauxNews(query || settings.macroQuery, settings.marketauxApiKey) },
    { id: 'finnhub', label: 'Finnhub', enabled: use('finnhub') && Boolean(settings.finnhubApiKey), run: () => fetchFinnhubNews(settings.finnhubApiKey) }
  ].filter(task => task.enabled);

  const results = await Promise.all(tasks.map(async task => {
    try {
      const events = await task.run();
      return { id: task.id, label: task.label, events: (events || []).slice(0, 8) };
    } catch {
      return { id: task.id, label: task.label, events: [] };
    }
  }));

  return results.filter(result => result.events.length);
}

function readMacroCache(cacheKey) {
  return readJSON(MACRO_CACHE_KEY, {})[cacheKey] || null;
}

function writeMacroCache(cacheKey, events) {
  const cache = readJSON(MACRO_CACHE_KEY, {});
  writeJSON(MACRO_CACHE_KEY, {
    ...cache,
    [cacheKey]: {
      timestamp: Date.now(),
      events
    }
  });
}

async function fetchJsonWithFallbacks(urls) {
  const targets = urls.filter((target, index, list) => target && list.indexOf(target) === index);
  const errors = [];
  for (const target of targets) {
    try {
      const response = await fetch(target);
      if (!response.ok) {
        errors.push(`${target}: HTTP ${response.status}`);
        if (response.status === 429) {
          const error = new Error(errors.join(' | '));
          error.code = 'RATE_LIMIT';
          throw error;
        }
        continue;
      }
      return await response.json();
    } catch (error) {
      if (error.code === 'RATE_LIMIT') throw error;
      errors.push(`${target}: ${error.message || 'erreur reseau'}`);
    }
  }
  throw new Error(errors.join(' | ') || 'Source indisponible');
}

async function fetchMarketauxNews(query, apiKey) {
  const url = `https://api.marketaux.com/v1/news/all?api_token=${encodeURIComponent(apiKey)}&search=${encodeURIComponent(query)}&language=en,fr&limit=8`;
  const response = await fetch(url);
  if (!response.ok) throw new Error('Marketaux indisponible');
  const json = await response.json();
  return sortMacroEvents((json.data || []).map(article => enrichMacroEvent({
    title: article.title || 'News marche',
    summary: article.description || article.snippet || '',
    sentiment: scoreToSentiment(article.sentiment_score),
    tags: (article.entities || []).slice(0, 3).map(entity => entity.symbol || entity.name).filter(Boolean),
    source: article.source || 'Marketaux',
    url: article.url,
    impact: {},
    provider: 'Marketaux',
    providerScore: Number(article.sentiment_score || 0)
  }, 'marketaux')));
}

async function fetchOkSurfNews() {
  const response = await fetch('https://ok.surf/api/v1/cors/news-section', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sections: ['Business', 'World', 'Technology'] })
  });
  if (!response.ok) throw new Error('OKSURF indisponible');
  const json = await response.json();
  return sortMacroEvents(Object.entries(json || {})
    .flatMap(([section, articles]) => (Array.isArray(articles) ? articles : []).map(article => ({ ...article, section })))
    .slice(0, 8)
    .map(article => enrichMacroEvent({
      title: article.title || 'Actualite macro',
      summary: `${article.source || article.section || 'News'} · OKSURF`,
      sentiment: sectionToSentiment(article.section),
      tags: ['Macro', article.section || 'News'],
      source: article.source || 'OKSURF',
      url: article.link,
      impact: {},
      provider: 'OKSURF',
      section: article.section || ''
    }, 'oksurf')));
}

async function fetchFinnhubNews(apiKey) {
  const url = `https://finnhub.io/api/v1/news?category=general&token=${encodeURIComponent(apiKey)}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error('Finnhub indisponible');
  const json = await response.json();
  return sortMacroEvents((json || []).slice(0, 8).map(article => enrichMacroEvent({
    title: article.headline || 'News marche',
    summary: article.summary || '',
    sentiment: 'Neutre',
    tags: ['Finance'],
    source: article.source || 'Finnhub',
    url: article.url,
    impact: {},
    provider: 'Finnhub'
  }, 'finnhub')));
}

export async function fetchYahooFinanceNews(query = 'markets economy inflation rates') {
  const response = await fetch(proxied(yahooNewsUrl(query)));
  if (!response.ok) throw new Error('Yahoo Finance news indisponible');
  const json = await response.json();
  return sortMacroEvents((json.news || []).slice(0, 8).map(article => enrichMacroEvent({
    title: article.title || 'News Yahoo Finance',
    summary: `${article.publisher || 'Yahoo Finance'} · Yahoo Finance`,
    sentiment: 'Neutre',
    tags: ['Finance'],
    source: article.publisher || 'Yahoo Finance',
    url: article.link,
    impact: {},
    provider: 'Yahoo Finance'
  }, 'yahoo')));
}

export async function fetchPositionNews(position) {
  const symbol = position.lastQuoteSymbol || position.yahooTicker || position.ticker || position.name;
  const response = await fetch(proxied(yahooNewsUrl(symbol)));
  if (!response.ok) return [];
  const json = await response.json();
  return (json.news || []).slice(0, 3).map(article => enrichMacroEvent({
    title: article.title || 'Actualite titre',
    summary: `${article.publisher || 'Yahoo Finance'} · ${position.ticker}`,
    sentiment: 'Neutre',
    tags: ['Titre', position.ticker],
    source: article.publisher || 'Yahoo Finance',
    url: article.link,
    impact: {},
    provider: 'Yahoo Finance'
  }, 'yahoo'));
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

function sectionToSentiment(section) {
  if (String(section || '').toLowerCase().includes('business')) return 'Neutre';
  return 'Neutre';
}

function enrichMacroEvent(event, provider = '') {
  const analysis = analyzeMacroText(event, provider);
  return {
    ...event,
    sentiment: analysis.sentiment,
    macroTheme: analysis.theme,
    impactLevel: analysis.impactLevel,
    impactScore: analysis.impactScore,
    sentimentScore: analysis.sentimentScore,
    macroPriority: analysis.priority,
    analysisLabel: analysis.rationale,
    provider: event.provider || provider || '',
    impact: event.impact || {}
  };
}

function analyzeMacroText(event, provider = '') {
  const text = normalizeMacroText([event.title, event.summary, event.source, event.section, ...(event.tags || [])].join(' '));
  const nativeBias = providerBias(provider, event);
  const topicMatches = MACRO_TOPICS
    .map(topic => {
      const count = topic.keywords.reduce((total, keyword) => total + (text.includes(keyword) ? 1 : 0), 0);
      return { ...topic, count };
    })
    .filter(topic => topic.count > 0);

  const dominantTopic = topicMatches.sort((a, b) => (b.count * b.impact) - (a.count * a.impact))[0];
  let sentimentScore = nativeBias.score;
  let impactScore = Math.max(nativeBias.impact, dominantTopic?.impact || 1);
  const reasons = [];

  MACRO_SENTIMENT_RULES.forEach(rule => {
    const matches = text.match(rule.pattern);
    if (!matches?.length) return;
    const weight = matches.length;
    sentimentScore += rule.score * weight;
    impactScore = Math.max(impactScore, rule.impact);
    reasons.push(rule.rationale);
  });

  if (dominantTopic) {
    impactScore = Math.max(impactScore, dominantTopic.impact);
  }

  if (!dominantTopic && isMostlyCorporate(text)) {
    impactScore = 1;
  }
  if (isMostlyCorporate(text) && !hasSystemicMacroTopic(topicMatches)) {
    impactScore = Math.min(impactScore, 2);
  }

  const theme = dominantTopic?.label || (isMostlyCorporate(text) ? 'Entreprise / marche' : 'Macro generale');
  const sentiment = scoreToLabel(sentimentScore);
  const impactLevel = impactScore >= 5 ? 'Fort' : impactScore >= 3 ? 'Moyen' : 'Faible';
  const rationale = compactReasons(reasons, dominantTopic?.label, sentiment, impactLevel);
  const priority = impactScore * 10 + Math.min(9, Math.abs(sentimentScore));

  return { sentiment, sentimentScore, impactScore, impactLevel, theme, rationale, priority };
}

function providerBias(provider, event) {
  const key = String(provider || '').toLowerCase();
  if (key === 'gdelt') {
    const tone = Number(event.providerTone || 0);
    return { score: clamp(Math.round(tone / 1.5), -2, 2), impact: Math.abs(tone) > 3 ? 4 : 2 };
  }
  if (key === 'marketaux') {
    const score = Number(event.providerScore || 0);
    return { score: clamp(Math.round(score * 8), -2, 2), impact: Math.abs(score) > 0.35 ? 4 : 2 };
  }
  if (key === 'oksurf') {
    const section = normalizeMacroText(event.section || '');
    if (section.includes('world')) return { score: 0, impact: 4 };
    if (section.includes('business')) return { score: 0, impact: 3 };
    if (section.includes('technology')) return { score: 0, impact: 2 };
  }
  return { score: 0, impact: 1 };
}

function scoreToLabel(score) {
  if (score >= 2) return 'Positif';
  if (score <= -2) return 'Negatif';
  return 'Neutre';
}

function compactReasons(reasons, theme, sentiment, impactLevel) {
  const unique = [...new Set(reasons)];
  const lead = unique.slice(0, 2).join(' + ');
  if (lead) return `${theme} · impact ${impactLevel.toLowerCase()} · ${lead}`;
  if (sentiment === 'Neutre') return `${theme} · impact ${impactLevel.toLowerCase()} · signal macro faible ou mixte`;
  return `${theme} · impact ${impactLevel.toLowerCase()} · signal ${sentiment.toLowerCase()}`;
}

function normalizeMacroText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9/%+\-. ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isMostlyCorporate(text) {
  return /(ipo|earnings|quarterly results|merger|acquisition|wall street|shares|stock futures|investors)/.test(text)
    && !/(inflation|fed|ecb|bce|rates|yield|gdp|recession|oil|gas|tariff|sanction|jobs|unemployment)/.test(text);
}

function hasSystemicMacroTopic(topicMatches = []) {
  return topicMatches.some(topic => !['corporate', 'technology'].includes(topic.id));
}

function sortMacroEvents(events = []) {
  return events.slice().sort((a, b) => (b.macroPriority || 0) - (a.macroPriority || 0) || (b.impactScore || 0) - (a.impactScore || 0));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export async function refreshQuotes(onProgress = () => {}) {
  const current = getData();
  const nextPortfolios = [];
  const stats = { total: 0, updated: 0, failed: 0, failures: [] };
  for (const portfolio of getPortfolios()) {
    const positions = [];
    for (const position of portfolio.positions) {
      stats.total += 1;
      try {
        if (!position.yahooTicker && !position.ticker) throw new Error('Ticker absent');
        const chart = normalizeChartScale(await fetchMarketChart(position), position);
        const nextPosition = {
          ...position,
          yahooTicker: chart.symbol || position.yahooTicker || position.ticker,
          currentPrice: round3(chart.price),
          history: chart,
          lastUpdate: new Date().toISOString(),
          lastQuoteSource: chart.source || 'Source marche',
          lastQuoteSymbol: chart.symbol || position.yahooTicker || position.ticker,
          lastQuoteStatus: 'ok',
          lastQuoteError: ''
        };
        const stop = suggestedStop(nextPosition, portfolio.profileId);
        positions.push({ ...nextPosition, suggestedStop: round3(stop.stop), atr14: stop.atr ? round3(stop.atr) : null });
        stats.updated += 1;
        onProgress(position.ticker, true, null);
      } catch (error) {
        const message = error.message || 'Cours indisponible';
        positions.push({ ...position, lastQuoteStatus: 'error', lastQuoteError: message });
        stats.failed += 1;
        stats.failures.push({ ticker: position.ticker || position.name, message });
        onProgress(position.ticker, false, message);
      }
    }
    nextPortfolios.push({ ...portfolio, positions });
  }
  saveData({ ...current, portfolios: nextPortfolios });
  saveSettings({ lastQuotesRefreshAt: new Date().toISOString() });
  return { ...totals(nextPortfolios), refreshStats: stats };
}

function normalizeChartScale(chart, position) {
  const reference = [position.currentPrice, position.pru].map(parseLocaleNumber).find(value => value > 0);
  const price = normalizeQuoteValue(chart.price, reference);
  if (!reference) return { ...chart, price };
  const factor = price && chart.price ? price / parseLocaleNumber(chart.price) : 1;
  return {
    ...chart,
    price,
    closes: scaleSeries(chart.closes, factor),
    highs: scaleSeries(chart.highs, factor),
    lows: scaleSeries(chart.lows, factor)
  };
}

function normalizeQuoteValue(value, reference = 0) {
  const price = parseLocaleNumber(value);
  if (!price || !reference) return price;
  const candidates = [price, price / 10, price / 100, price / 1000, price / 10000, price * 10, price * 100, price * 1000]
    .filter(candidate => Number.isFinite(candidate) && candidate > 0);
  return candidates.sort((a, b) => Math.abs(Math.log(a / reference)) - Math.abs(Math.log(b / reference)))[0] || price;
}

function scaleSeries(values = [], factor = 1) {
  return values.map(value => round3(parseLocaleNumber(value) * factor)).filter(isPositiveNumber);
}

function isPositiveNumber(value) {
  return Number.isFinite(value) && value > 0;
}
