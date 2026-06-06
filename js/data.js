/**
 * AlphaTerminal Data Service
 * Demo data and Yahoo Finance fetching
 */

export const DEMO_PORTFOLIOS = [
    {
      id: 'jean-pea',
      name: 'Jean — PEA',
      type: 'PEA',
      owner: 'Jean',
      versements: 85000,
      positions: [
        { ticker: 'CW8.PA', isin: 'FR0010389030', name: 'Amundi MSCI World', qty: 320, pru: 105.20, currentPrice: 145.30, stopLevel: 125.0, type: 'Actions' },
        { ticker: 'PUST.PA', isin: 'LU1681049109', name: 'Amundi Nasdaq-100', qty: 85, pru: 210.0, currentPrice: 258.40, stopLevel: 230.0, type: 'Actions' },
        { ticker: 'ETZ.PA', isin: 'FR0010296061', name: 'BNP Easy Stoxx 600', qty: 200, pru: 88.5, currentPrice: 96.1, stopLevel: 85.0, type: 'Actions' },
        { ticker: 'MMS.PA', isin: 'FR0010149120', name: 'Lyxor MSCI World', qty: 110, pru: 195.0, currentPrice: 218.0, stopLevel: 190.0, type: 'Actions' },
        { ticker: 'PAEEM.PA', isin: 'LU1681045370', name: 'Amundi MSCI EM', qty: 150, pru: 62.0, currentPrice: 68.5, stopLevel: 58.0, type: 'Actions' },
        { ticker: 'EXX1.DE', isin: 'DE0005933931', name: 'iShares Core DAX', qty: 45, pru: 136.0, currentPrice: 152.0, stopLevel: 130.0, type: 'Actions' }
      ]
    },
    {
      id: 'jean-cto',
      name: 'Jean — CTO',
      type: 'CTO',
      owner: 'Jean',
      versements: 12000,
      positions: [
        { ticker: 'AAPL', isin: 'US0378331005', name: 'Apple Inc.', qty: 35, pru: 165.0, currentPrice: 189.5, stopLevel: 170.0, type: 'Actions' },
        { ticker: 'TSLA', isin: 'US88160R1014', name: 'Tesla Inc.', qty: 12, pru: 210.0, currentPrice: 168.0, stopLevel: 155.0, type: 'Actions' },
        { ticker: 'ENGI.PA', isin: 'FR0010208488', name: 'Engie SA', qty: 200, pru: 14.5, currentPrice: 16.2, stopLevel: 13.8, type: 'Actions' }
      ]
    },
    {
        id: 'marie-cto',
        name: 'Marie — CTO',
        type: 'CTO',
        owner: 'Marie',
        versements: 5000,
        positions: [
            { ticker: 'MSFT', isin: 'US5949181045', name: 'Microsoft', qty: 10, pru: 320.0, currentPrice: 415.0, stopLevel: 380.0, type: 'Actions' },
            { ticker: 'BTC-USD', isin: 'CRYPTO', name: 'Bitcoin', qty: 0.05, pru: 45000, currentPrice: 62000, stopLevel: 55000, type: 'Crypto' }
        ]
    }
];

export const INVESTOR_PROFILES = {
    prudent: {
        name: 'Prudent',
        targetReturn: '3-5%',
        horizon: '< 3 ans',
        allocation: { actions: 30, obligations: 50, cash: 20, crypto: 0 }
    },
    equilibre: {
        name: 'Équilibré',
        targetReturn: '5-8%',
        horizon: '3-7 ans',
        allocation: { actions: 50, obligations: 35, cash: 15, crypto: 0 }
    },
    dynamique: {
        name: 'Dynamique',
        targetReturn: '8-12%',
        horizon: '5-10 ans',
        allocation: { actions: 70, obligations: 15, cash: 15, crypto: 0 }
    },
    offensif: {
        name: 'Offensif',
        targetReturn: '12-20%',
        horizon: '> 7 ans',
        allocation: { actions: 90, obligations: 0, cash: 10, crypto: 0 }
    },
    dca: {
        name: 'DCA Automatique',
        targetReturn: 'Cumulatif',
        horizon: 'Long terme',
        allocation: { actions: 100, obligations: 0, cash: 0, crypto: 0 }
    }
};

export const MACRO_DATA = [
    { id: 1, title: 'Taux Fed', summary: 'Statu quo attendu, pivot possible en S2.', impact: 'Neutre', tags: ['Growth', 'Tech'] },
    { id: 2, title: 'Énergie', summary: 'Tensions en Mer Rouge impactent le brut.', impact: 'Négatif', tags: ['Transport', 'Industrie'] },
    { id: 3, title: 'IA / Tech', summary: 'Résultats Nvidia confirment la demande massive.', impact: 'Positif', tags: ['Semiconducteurs', 'Big Tech'] }
];

export const DataService = {
    async fetchPrice(ticker) {
        try {
            const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1mo`;
            const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
            const response = await fetch(proxyUrl);
            const data = await response.json();

            if (data.chart && data.chart.result && data.chart.result[0]) {
                const result = data.chart.result[0];
                const meta = result.meta;
                const quotes = result.indicators.quote[0].close;
                return {
                    price: meta.regularMarketPrice,
                    change: meta.regularMarketPrice - meta.chartPreviousClose,
                    changePercent: ((meta.regularMarketPrice - meta.chartPreviousClose) / meta.chartPreviousClose) * 100,
                    history: quotes.filter(p => p !== null)
                };
            }
        } catch (error) {
            console.error(`Error fetching ${ticker}:`, error);
        }
        return null;
    },

    calculateTechnicalSignals(history) {
        if (!history || history.length < 14) return null;

        // RSI Simple Calculation
        let gains = 0;
        let losses = 0;
        for (let i = history.length - 14; i < history.length; i++) {
            const diff = history[i] - history[i-1];
            if (diff >= 0) gains += diff;
            else losses -= diff;
        }
        const rs = gains / (losses || 1);
        const rsi = 100 - (100 / (1 + rs));

        return {
            rsi: Math.round(rsi),
            status: rsi < 30 ? 'Survendu' : (rsi > 70 ? 'Suracheté' : 'Neutre')
        };
    }
};
