/** Yahoo Finance instrument lookup for manual position entry.
 * A suggestion is advisory: users can always enter/keep a ticker manually.
 */
import { getSettings,getPortfolios } from './store.js';
import { instrumentKey } from './instruments.js';

const sanitize=value=>String(value??'').replace(/[\u0000-\u001f]/g,'').trim();
const SYMBOL=/^[A-Z0-9.\-^=]{1,36}$/;
const ISIN=/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;
const quoteTypes=new Set(['EQUITY','ETF','MUTUALFUND','INDEX']);
const cache=new Map();
export function normalizeSuggestions(quotes=[]){
  const output=[],seen=new Set();
  for(const item of quotes||[]){
    const symbol=sanitize(item.symbol).toUpperCase();
    if(!SYMBOL.test(symbol)||seen.has(symbol))continue;
    const name=sanitize(item.longname||item.shortname||item.name||symbol).slice(0,160);
    const kind=sanitize(item.quoteType).toUpperCase();
    if(kind&&!quoteTypes.has(kind))continue;
    seen.add(symbol);
    output.push({symbol,name,exchange:sanitize(item.exchDisp||item.exchange).slice(0,48),
      kind,isin:ISIN.test(sanitize(item.isin).toUpperCase())?sanitize(item.isin).toUpperCase():''});
    if(output.length>=8)break;
  }
  return output;
}
function proxyUrl(url){
  const proxy=getSettings().corsProxy||'https://proxy.sicho.workers.dev/?url=';
  if(!/^https:\/\//i.test(proxy))throw Error('Proxy HTTPS requis');
  return proxy.includes('{url}')?proxy.replace('{url}',encodeURIComponent(url)):proxy+encodeURIComponent(url);
}
export async function searchYahooInstruments(query,{signal}={}){
  const term=sanitize(query).slice(0,64);
  if(term.length<2)return [];
  const cacheKey=term.toLowerCase();
  const saved=cache.get(cacheKey);
  if(saved&&Date.now()-saved.time<5*60*1000)return saved.results;
  const local=getPortfolios().flatMap(p=>p.positions||[])
    .filter(p=>[p.name,p.ticker,p.yahooTicker,p.isin].some(v=>sanitize(v).toLowerCase().includes(cacheKey)));
  const localQuotes=local.map(p=>({symbol:p.yahooTicker||p.ticker,
    longname:p.name,isin:p.isin,exchange:'Déjà détenu',quoteType:p.assetClass==='ETF'?'ETF':'EQUITY'}));
  const url=new URL('https://query1.finance.yahoo.com/v1/finance/search');
  url.search=new URLSearchParams({q:term,quotesCount:'8',newsCount:'0',lang:'fr-FR',region:'FR'}).toString();
  let result=normalizeSuggestions(localQuotes);
  try{
    const response=await fetch(proxyUrl(url.href),{signal,cache:'no-store'});
    if(!response.ok)throw Error('Service Yahoo indisponible');
    const data=await response.json();
    result=normalizeSuggestions([...localQuotes,...(data.quotes||[])]);
  }catch(error){
    if(error.name==='AbortError')throw error;
    // Keep local instruments available even without the public Yahoo endpoint.
  }
  if(!signal?.aborted)cache.set(cacheKey,{time:Date.now(),results:result});
  return result;
}
